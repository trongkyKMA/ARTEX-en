package notify

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// emailDialTimeout / emailSessionTimeout bound connection setup and the whole SMTP session respectively.
// net/smtp itself has no timeouts at all; without these two, a stuck peer would leave the
// delivery goroutine hanging forever, and since the dispatcher processes serially in a single goroutine,
// the whole notification system would stall.
const (
	emailDialTimeout    = 10 * time.Second
	emailSessionTimeout = 45 * time.Second
)

// emailChannel implements SMTP email delivery.
type emailChannel struct{}

func (emailChannel) Kind() string { return KindEmail }

// Email has no platform rate limit, but it should not be used to flood inboxes; use a generous default.
func (emailChannel) DefaultRatePerMin() int { return 60 }

// Only the password is masked. SMTP host, account and recipients are not secrets, and masking them only makes editing harder.
func (emailChannel) SecretKeys() []string { return []string{"password"} }

// host/port decide which server receives the password; tls decides whether transport is encrypted. Any change to these three
// requires restating the password, which also means "turning off TLS" must explicitly include the credential rather than being a casual edit.
func (emailChannel) DestinationKeys() []string { return []string{"host", "port", "tls"} }

func (emailChannel) Validate(cfg map[string]any) error {
	if cfgString(cfg, "host") == "" {
		return errors.New("SMTP server address is required")
	}
	port := cfgInt(cfg, "port")
	if port <= 0 || port > 65535 {
		return errors.New("invalid SMTP port (must be 1-65535)")
	}
	if cfgString(cfg, "from") == "" {
		return errors.New("sender address is required")
	}
	if len(cfgStrings(cfg, "to")) == 0 {
		return errors.New("at least one recipient address is required")
	}
	return nil
}

func (c emailChannel) Send(ctx context.Context, cfg map[string]any, m Message) (int, error) {
	if err := c.Validate(cfg); err != nil {
		return 0, Permanent(err)
	}
	host := cfgString(cfg, "host")
	port := cfgInt(cfg, "port")
	from := cfgString(cfg, "from")
	to := cfgStrings(cfg, "to")
	username := cfgString(cfg, "username")
	password := cfgString(cfg, "password")
	implicitTLS := cfgBool(cfg, "tls")

	msg, err := buildEmailMessage(from, to, m)
	if err != nil {
		return 0, Permanent(err)
	}

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	client, err := emailDial(ctx, addr, host, implicitTLS)
	if err != nil {
		return 0, err
	}
	defer client.Close()

	// STARTTLS: upgrade if the peer supports it. Credentials must not be sent over a plaintext session (see the auth note below).
	if !implicitTLS {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
				return 0, fmt.Errorf("STARTTLS failed: %w", err)
			}
		}
	}
	if username != "" {
		if err := client.Auth(smtp.PlainAuth("", username, password, host)); err != nil {
			// smtp.PlainAuth refuses to send credentials over an unencrypted connection (unless the target is localhost).
			// This is **correct** security behaviour and must not be bypassed, but the reason needs a clear explanation,
			// otherwise the user only sees "unencrypted connection" without knowing what to do.
			if strings.Contains(err.Error(), "unencrypted connection") {
				return 0, Permanent(fmt.Errorf("refusing to send credentials: the connection is not encrypted. Enable TLS on the server, or use port 465 with \"Implicit TLS\" turned on (%w)", err))
			}
			return 0, Permanent(fmt.Errorf("SMTP authentication failed: %w", err))
		}
	}
	if err := client.Mail(from); err != nil {
		return 0, smtpStageError(fmt.Sprintf("sender %s rejected", from), err)
	}
	for _, rcpt := range to {
		if err := client.Rcpt(rcpt); err != nil {
			return 0, smtpStageError(fmt.Sprintf("recipient %s rejected", rcpt), err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return 0, fmt.Errorf("SMTP DATA failed: %w", err)
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return 0, fmt.Errorf("failed to write message body: %w", err)
	}
	if err := w.Close(); err != nil {
		return 0, fmt.Errorf("failed to submit message: %w", err)
	}
	// A Quit failure does not change the fact that "the server accepted the mail", so its error is ignored.
	_ = client.Quit()
	// Email has no length truncation (the whole HTML body is sent), so the whole batch counts as delivered.
	return len(m.Items), nil
}

// emailDial establishes the SMTP connection.
//
// implicitTLS=true uses the "TLS on connect" style such as port 465; false connects in plaintext on 25/587 and then
// upgrades with STARTTLS. The two must not be mixed: sending a plaintext greeting to port 465 gets the connection dropped.
//
// The session deadline is set **at connection time** (not afterwards), because net/smtp's Client hides the underlying
// connection in an unexported field that callers cannot reach; once the connection is handed over, only a deadline set in advance
// can act as the backstop. This also covers blocking during the handshake.
// Control hooks blockInternalDial, the same guard the HTTP-based channels share. Without it SMTP
// would be the gap in the whole SSRF defence: a host of 169.254.169.254 or 127.0.0.1 could be reached directly,
// and when smtp.NewClient fails the handshake it wraps the peer's reply line into the error, which last_error
// echoes back through the delivery history API, forming a semi-blind read primitive; the timing difference of "connection refused vs timeout" could also
// be used to probe ports. The dial stage is the final enforcement point and also covers DNS rebinding.
func emailDial(ctx context.Context, addr, host string, implicitTLS bool) (*smtp.Client, error) {
	d := &net.Dialer{Timeout: emailDialTimeout, Control: blockInternalDial}
	var conn net.Conn
	var err error
	if implicitTLS {
		conn, err = tls.DialWithDialer(d, "tcp", addr, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SMTP server: %w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(emailSessionTimeout))
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("SMTP handshake failed: %w", err)
	}
	return client, nil
}

// smtpStageError classifies a stage failure as "retryable" or "permanent" based on the SMTP reply code.
//
// Why the distinction is required: SMTP 4xx and 5xx mean completely different things:
//   - 4xx (450 greylisting, 451 local error, 452 insufficient storage) are **temporary** rejections,
//     and the proper response is to retry later; greylisting in particular is hit on almost every first delivery.
//   - 5xx (550 user does not exist, 553 invalid address) are permanent rejections; retrying is pointless.
//
// If everything were treated as permanent, a mail server with greylisting would make **every** push land in
// failed after the first attempt, while this kind of failure is exactly where automatic retry matters most.
// The reply code is the first three digits of the error text; when no code can be found it is treated as retryable (better to try once more
// than to declare a possibly transient fault dead just because it could not be parsed).
func smtpStageError(what string, err error) error {
	code := smtpReplyCode(err.Error())
	if code >= 500 && code < 600 {
		return Permanent(fmt.Errorf("%s: %w", what, err))
	}
	return fmt.Errorf("%s: %w", what, err)
}

// smtpReplyCode extracts the leading three-digit reply code from SMTP error text, or returns 0 if none.
// net/smtp does not export an error code field, so it has to come from the text; the format is "450 4.7.1 ...".
func smtpReplyCode(text string) int {
	if len(text) < 3 {
		return 0
	}
	n, err := strconv.Atoi(text[:3])
	if err != nil {
		return 0
	}
	return n
}

// buildEmailMessage assembles the complete RFC 5322 message.
//
// The body is base64-encoded for two reasons: SMTP limits a line to 1000 bytes, and HTML
// bodies (digest mails especially) easily produce overlong lines; and base64 never produces lines starting with ".",
// which avoids SMTP dot-stuffing.
func buildEmailMessage(from string, to []string, m Message) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(to, ", "))
	// Non-ASCII (e.g. Chinese) subjects must be RFC 2047 encoded, or clients display them as mojibake.
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", htmlTitle(m)))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n")
	// Email has no hard length limit, so the body is not truncated.
	b.WriteString("\r\n")
	encoded := base64.StdEncoding.EncodeToString([]byte(htmlBody(m, 0)))
	// base64 wrapped at 76 characters, per RFC 2045.
	for len(encoded) > 76 {
		b.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	b.WriteString(encoded + "\r\n")
	return b.String(), nil
}
