package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
)

// allowLocalTargets decides whether messages may be delivered to loopback / link-local addresses.
//
// Denied by default. These ranges are not where IM robots or public mail servers live, while what they can
// reach is sensitive: another service's admin port on the same host, and the cloud metadata endpoint
// (169.254.169.254, which exposes instance credentials). Delivery addresses are configured by admins, but an admin session borrowed via XSS/CSRF,
// or a second person sharing the same JWT, could read response content back by changing the config:
// doJSON writes the first 200 bytes of a 4xx/5xx response body into last_error, and the delivery history API
// echoes it back, which is a semi-blind read primitive.
//
// But a "local SMTP relay" (postfix on 127.0.0.1:25) is a common setup for self-hosted mail,
// and a blanket ban would block people. So there is an explicit escape hatch instead of a hard-coded allowance:
// setting ARTEX_NOTIFY_ALLOW_LOCAL=1 allows it.
//
// It is exported as AllowLocalTargetsEnv so tests can explicitly enable it: test cases in this package and the server package
// make heavy use of httptest fake receivers on 127.0.0.1, which the guard would otherwise all block.
const AllowLocalTargetsEnv = "ARTEX_NOTIFY_ALLOW_LOCAL"

func allowLocalTargets() bool {
	v := strings.TrimSpace(os.Getenv(AllowLocalTargetsEnv))
	return v == "1" || strings.EqualFold(v, "true")
}

// isBlockedDialIP reports whether the target IP belongs to a range that is "not allowed for delivery by default".
//
// Only loopback, link-local (including cloud metadata 169.254.169.254), unspecified and multicast are rejected.
// RFC1918 private networks are **not rejected**: self-hosted Mattermost / SMTP relays on internal networks are a very common legitimate use,
// and blocking them too would make the feature unusable in real environments. This trade-off is deliberate:
// the protection must block the truly sensitive targets without breaking normal deployments.
func isBlockedDialIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	// IPv4-mapped IPv6 (::ffff:127.0.0.1) must be converted back to IPv4 before checking, or the check is bypassed.
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

// blockInternalDial is the Control hook of the http.Transport dialer; it checks the target address **when the connection
// is established**.
//
// Why at the dial stage rather than only validating when the config is saved: this is the final enforcement point.
// It covers both ways of bypassing config validation: DNS rebinding (resolving to a public IP at validation time
// and to an internal one at connect time) and redirects (although cross-host redirects are already rejected, a same-host redirect
// could still point the path elsewhere).
func blockInternalDial(_, address string, _ syscall.RawConn) error {
	if allowLocalTargets() {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("cannot parse target address %q", host)
	}
	if isBlockedDialIP(ip) {
		return fmt.Errorf("refusing to deliver to loopback/link-local address %s (to deliver to a local service on purpose, set %s=1)", ip, AllowLocalTargetsEnv)
	}
	return nil
}

// notifyTransport adds only a dial guard on top of the default Transport.
// Clone keeps all default tuning (connection pool, HTTP/2, timeouts, proxy, etc.),
// to avoid changing other behaviour just to add one check.
var notifyTransport = func() *http.Transport {
	t, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return &http.Transport{}
	}
	clone := t.Clone()
	clone.DialContext = (&net.Dialer{Timeout: 10 * time.Second, Control: blockInternalDial}).DialContext
	return clone
}()

// httpClient is the client shared by all channel deliveries.
//
// It deliberately does **not** reuse the project's global egress proxy (the server-side GlobalProxy): that proxy is for penetration
// target traffic and is often an unstable tunnel, and notification availability should not be held hostage by target network jitter.
// IM pushes can connect directly. The timeout is 15 seconds: a peer slower than that is effectively already failing.
//
// Cross-host redirects are rejected: delivery addresses for this feature are all "one fixed endpoint" and normally never
// redirect to another host; and these providers' credentials (DingTalk access_token, WeCom key, Telegram
// bot token) are **in the URL**, so following a cross-host redirect would hand the credential to the redirect target. Same-host
// redirects (e.g. adding a trailing slash) are still allowed.
var httpClient = &http.Client{
	Timeout:   15 * time.Second,
	Transport: notifyTransport,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if len(via) > 0 && req.URL.Host != via[0].URL.Host {
			return fmt.Errorf("refusing cross-host redirect (%s → %s)", via[0].URL.Host, req.URL.Host)
		}
		return nil
	},
}

// respBodyLimit caps how much of the response body is read. A misbehaving peer may return huge content, while we only need
// the error code and a short error description to show in delivery history.
const respBodyLimit = 8 << 10

// doJSON sends one request and returns the response body (length-limited).
//
// When payload is nil an empty body is sent (for GET or platforms that do not require a body).
// Keys and values in headers are attached as-is, for the generic webhook's custom headers.
//
// Error classification is this function's core job: network-level failures and 5xx/408/429 are "retryable",
// the remaining 4xx are "permanent"; retrying a 403 just logs the same error three times.
func doJSON(ctx context.Context, method, url string, headers map[string]string, payload any) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			// A serialization failure is a local bug (wrong config field type); retrying will not help.
			return nil, Permanent(fmt.Errorf("failed to build request body: %w", err))
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		// Invalid URL: most likely the user entered the address wrong, which is a permanent failure.
		// Again err must not be passed through: url.Parse's error text contains the full URL.
		return nil, Permanent(fmt.Errorf("invalid request URL: %s", redactRequestTarget(url)))
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		// Connection refused, DNS failure, timeout: mostly transient faults, left to backoff retries.
		//
		// The error text must be redacted before being passed on. Reason: http.Client.Do returns a *url.Error
		// whose Error() is `Op "full URL": underlying error`, and for these providers the credential is **in the URL**
		// (DingTalk access_token, WeCom key, Feishu hook id, Telegram /bot<token>/).
		// Without redaction the credential would flow along this error string to four places: notification_deliveries
		// last_error (stored in plaintext), the delivery history API response (**bypassing the channel config masking**),
		// server logs, and the 502 text the test-send endpoint returns to the frontend.
		return nil, fmt.Errorf("request failed: %s", redactTransportError(err))
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, respBodyLimit))
	if readErr != nil {
		return nil, fmt.Errorf("failed to read response: %w", readErr)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return raw, nil
	}
	// 429 (rate limited) and 408 (timeout) are worth retrying; other 4xx are config or permission problems and retrying is pointless.
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusRequestTimeout {
		return nil, fmt.Errorf("remote rate-limited or timed out (HTTP %d): %s", resp.StatusCode, snippet(raw))
	}
	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("remote server error (HTTP %d): %s", resp.StatusCode, snippet(raw))
	}
	return nil, Permanent(fmt.Errorf("remote rejected the request (HTTP %d): %s", resp.StatusCode, snippet(raw)))
}

// snippet squeezes the response body into a short single line for error messages. Responses may contain newlines and lots of whitespace,
// and stuffing them into last_error as-is would break the delivery history page layout.
func snippet(raw []byte) string {
	return OneLine(string(raw), 200)
}

// redactRequestTarget reduces a delivery address to "scheme://host/…" for error messages.
//
// This is the package's single address redaction rule, and it is deliberately **blunt**: everything except scheme and host
// is dropped. The reason is that there is no "generic and safe" way to tell which part of a URL is the credential:
//
//	DingTalk  credential in query            /robot/send?access_token=xxx
//	WeCom     credential in query            /cgi-bin/webhook/send?key=xxx
//	Feishu    credential in **last path segment** /open-apis/bot/v2/hook/<hook_id>
//	Telegram  credential in **middle of path**    /bot<token>/sendMessage
//
// "Keeping only the useful part" would need per-channel patches, and missing any one provider means a credential leak.
// Keeping the host is already enough for troubleshooting (DNS failures, connection failures, bad certificates can all be located),
// and which robot it is can be identified from the masked suffix in the channel config.
//
// On parse failure a fixed placeholder is returned: the raw string is never echoed back.
func redactRequestTarget(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "(unparseable URL)"
	}
	return u.Scheme + "://" + u.Host + "/…"
}

// redactTransportError strips the address from a transport-level error, keeping only the underlying cause.
//
// *url.Error is structured as {Op, URL, Err}, and Error() prints the URL along with it.
// Taking the Err field explicitly, bypassing its Error(), is more reliable than string replacement afterwards,
// because replacement would have to handle all the URL-encoded/escaped variants correctly and is easy to get wrong.
func redactTransportError(err error) string {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		host := ""
		if u, parseErr := url.Parse(uerr.URL); parseErr == nil {
			host = u.Host
		}
		if uerr.Err != nil {
			return fmt.Sprintf("%s %s: %s", uerr.Op, host, uerr.Err)
		}
		return fmt.Sprintf("%s %s: unknown error", uerr.Op, host)
	}
	// Errors other than *url.Error (e.g. those returned by the redirect policy) may also contain the address, so they are redacted too.
	return redactURLsInText(err.Error())
}

// redactURLsInText replaces http(s) addresses appearing in a piece of text with their redacted form.
//
// It is the fallback for errors without structured fields (redirect policy errors, custom errors from third-party libraries).
// Only the http/https prefixes are recognized, splitting on whitespace and quotes, which never appear in an address.
func redactURLsInText(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		rest := s[i:]
		if strings.HasPrefix(rest, "http://") || strings.HasPrefix(rest, "https://") {
			end := len(rest)
			if j := strings.IndexAny(rest, " \t\n\"'"); j >= 0 {
				end = j
			}
			b.WriteString(redactRequestTarget(rest[:end]))
			i += end
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}
