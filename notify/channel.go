package notify

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
)

// Channel is the adapter for one notification channel. Implementations must be **stateless**: one instance is
// shared concurrently by many channel configs, and credentials always come in via the cfg argument.
type Channel interface {
	// Kind returns the channel type identifier; it must match the registry key.
	Kind() string
	// Validate is called when a config is saved and checks required fields and formats. The returned error is shown
	// directly to whoever configures it, so the text must say "which field is missing", not a generic "invalid config".
	Validate(cfg map[string]any) error
	// Send delivers one message and returns the **number of items actually delivered** and an error.
	//
	// Why return a count: every platform has a message length limit, and a digest that cannot hold the whole batch gets truncated.
	// If the caller unconditionally marked the whole batch as delivered, the truncated items would vanish: not in the message,
	// shown as successful in delivery history, with nowhere to notice the finding was never sent. With kept returned,
	// the caller marks only the first kept items and leaves the rest for the next batch.
	//
	// A returned error means delivery failed; a *PermanentError means it should not be retried.
	// On failure kept is meaningless and the caller should ignore it.
	Send(ctx context.Context, cfg map[string]any, m Message) (int, error)
	// DefaultRatePerMin returns the channel's officially recommended per-minute delivery limit, used as the default
	// rate limit for a new channel instance. 0 means no known limit.
	DefaultRatePerMin() int
	// SecretKeys returns the config keys of this channel that are credentials. Their values are masked when the API echoes them,
	// and a masked value received on update keeps the stored original. Only the implementation knows which fields are credentials
	// (the whole WeCom webhook URL is a credential, while for DingTalk only the secret is),
	// so this knowledge must come from the channel and cannot be guessed by upper layers.
	SecretKeys() []string
	// DestinationKeys returns the config keys of this channel that decide "where the message is sent".
	//
	// Like SecretKeys this is security-relevant: the destination and the credentials are separate fields,
	// and if "change only the address, keep the credentials as they are" were allowed, anyone able to edit a channel config could send
	// the real stored credentials to a server they control, and masking the channel config would become pointless.
	// See PrepareConfigUpdate.
	DestinationKeys() []string
}

// registry is the channel registry. It deliberately uses an explicit literal rather than init() self-registration: that way "which channels exist"
// is visible in one place, and a newly added channel exposes omissions at compile time instead of relying on runtime side effects.
var registry = map[string]Channel{
	KindDingTalk: dingTalkChannel{},
	KindFeishu:   feishuChannel{},
	KindWeCom:    weComChannel{},
	KindWebhook:  webhookChannel{},
	KindTelegram: telegramChannel{},
	KindEmail:    emailChannel{},
}

// Get returns the channel implementation for a type.
func Get(kind string) (Channel, bool) {
	c, ok := registry[kind]
	return c, ok
}

// ValidKind reports whether kind is a supported channel type.
func ValidKind(kind string) bool {
	_, ok := registry[kind]
	return ok
}

// Kinds returns all supported channel types in lexicographic order (for a stable UI dropdown).
func Kinds() []string {
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// PermanentError marks a delivery failure that should not be retried: bad credentials, rejected by the target, invalid request body, etc.
// Retrying only makes sense for transient faults (network jitter, rate limiting, peer 5xx); retrying a permanent failure with backoff
// never succeeds and buries the real error in retry logs.
type PermanentError struct{ Err error }

func (e *PermanentError) Error() string { return e.Err.Error() }
func (e *PermanentError) Unwrap() error { return e.Err }

// Permanent marks err as a permanent failure. It returns nil when err is nil,
// so you can write `return Permanent(someCheck())`.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return &PermanentError{Err: err}
}

// IsPermanent reports whether the err chain carries a permanent-failure mark.
func IsPermanent(err error) bool {
	var pe *PermanentError
	return errors.As(err, &pe)
}

// ---- config reading helpers ----
//
// Channel configs come from a JSONB database column; after encoding/json decoding they are map[string]any,
// numbers are always float64 and arrays are []any. The helpers below unify that conversion and tolerate
// type drift caused by users leaving fields empty in the UI (e.g. entering the port as a string).

// cfgString reads a string config item and always trims surrounding whitespace, which copy-pasting from web forms easily adds.
func cfgString(cfg map[string]any, key string) string {
	v, ok := cfg[key]
	if !ok {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

// cfgInt reads an integer config item, accepting both float64 (the JSON default) and string sources.
func cfgInt(cfg map[string]any, key string) int {
	switch v := cfg[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}

// cfgBool reads a boolean config item, also accepting the strings "true"/"1".
func cfgBool(cfg map[string]any, key string) bool {
	switch v := cfg[key].(type) {
	case bool:
		return v
	case string:
		s := strings.ToLower(strings.TrimSpace(v))
		return s == "true" || s == "1" || s == "yes"
	default:
		return false
	}
}

// cfgStrings reads a string array config item, trimming whitespace and dropping empty strings.
func cfgStrings(cfg map[string]any, key string) []string {
	raw, ok := cfg[key].([]any)
	if !ok {
		// A single string is also accepted, for convenient form submission when there is only one value.
		if s := cfgString(cfg, key); s != "" {
			return []string{s}
		}
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		s, ok := v.(string)
		if !ok {
			continue
		}
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// cfgMap reads a string map config item (e.g. custom HTTP headers), trimming keys and values and dropping empty keys.
func cfgMap(cfg map[string]any, key string) map[string]string {
	raw, ok := cfg[key].(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		s, ok := v.(string)
		if !ok {
			continue
		}
		out[k] = s
	}
	return out
}
