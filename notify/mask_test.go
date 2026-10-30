package notify

import (
	"errors"
	"strings"
	"testing"
)

func TestMaskedValueHidesBodyButKeepsTailHint(t *testing.T) {
	const secret = "https://oapi.dingtalk.com/robot/send?access_token=abcdef123456"
	got := MaskedValue(secret)
	if strings.Contains(got, "abcdef123456") {
		t.Fatalf("masked value leaked the full credential: %q", got)
	}
	if strings.Contains(got, "oapi.dingtalk.com") {
		t.Fatalf("masked value should not expose the body of the address: %q", got)
	}
	// The last 6 characters must be kept so users can recognize which robot it is.
	if !strings.HasSuffix(got, "123456") {
		t.Fatalf("the last 6 characters should be kept as an identifying hint: %q", got)
	}
	if !IsMasked(got) {
		t.Fatalf("the masked value must be recognized by IsMasked: %q", got)
	}
}

func TestMaskedValueShortSecretGivesNoHint(t *testing.T) {
	// Exposing the last 6 characters of a short credential would expose the whole credential.
	for _, s := range []string{"abc", "abcdef", ""} {
		got := MaskedValue(s)
		if got != MaskedPrefix {
			t.Fatalf("a credential of length %d should not get a suffix hint, got %q", len(s), got)
		}
		if s != "" && strings.Contains(got, s) {
			t.Fatalf("the masked value contains the original value: %q", got)
		}
	}
}

func TestMaskConfigMasksOnlySecrets(t *testing.T) {
	cfg := map[string]any{
		"webhook": "https://example.com/hook?token=SECRETVALUE",
		"secret":  "SECtest123456",
		"port":    float64(587),
		"host":    "smtp.example.com",
	}
	masked := MaskConfig(KindDingTalk, cfg)
	for _, k := range []string{"webhook", "secret"} {
		s, _ := masked[k].(string)
		if !IsMasked(s) {
			t.Errorf("%s should be masked, got %q", k, s)
		}
	}
	// Non-credential fields must be kept as-is, otherwise the UI cannot display them.
	if masked["port"] != float64(587) {
		t.Errorf("non-credential field port should not change: %v", masked["port"])
	}
}

func TestMaskConfigUnknownKindReturnsEmpty(t *testing.T) {
	// When the channel type is not recognized, better to have the UI show an empty config than to hand back raw content that may contain credentials.
	got := MaskConfig("nope", map[string]any{"webhook": "https://x/y?token=LEAK"})
	if len(got) != 0 {
		t.Fatalf("an unknown channel type should return an empty config, got %v", got)
	}
}

func TestMaskConfigDoesNotMutateInput(t *testing.T) {
	// Masking is presentation-layer behaviour and must not in turn change the real stored value.
	cfg := map[string]any{"webhook": "https://example.com/hook", "secret": "SECtest123456"}
	_ = MaskConfig(KindDingTalk, cfg)
	if IsMasked(cfg["secret"].(string)) {
		t.Fatal("MaskConfig modified its argument, which would overwrite the real credential with the masked value")
	}
}

func TestMergeConfigKeepsStoredOnMaskedIncoming(t *testing.T) {
	stored := map[string]any{"webhook": "https://real/hook", "secret": "REALSECRET", "method": "POST"}
	// The user changed only method; the browser submits the masked value + the new method.
	incoming := map[string]any{
		"webhook": MaskedValue("https://real/hook"),
		"secret":  MaskedValue("REALSECRET"),
		"method":  "PUT",
	}
	got := MergeConfig(stored, incoming)
	if got["webhook"] != "https://real/hook" || got["secret"] != "REALSECRET" {
		t.Fatalf("masked fields should keep the stored value, got %v", got)
	}
	if got["method"] != "PUT" {
		t.Fatalf("the modified field should take effect, got %v", got["method"])
	}
}

func TestMergeConfigEmptyStringClears(t *testing.T) {
	stored := map[string]any{"webhook": "https://real/hook", "secret": "REALSECRET"}
	got := MergeConfig(stored, map[string]any{"secret": ""})
	if _, ok := got["secret"]; ok {
		t.Fatalf("an empty string should clear the field, got %v", got)
	}
	// Fields not mentioned are kept (partial update semantics).
	if got["webhook"] != "https://real/hook" {
		t.Fatalf("fields not mentioned should be kept, got %v", got)
	}
}

func TestMergeConfigKeepsUnmentionedStoredKeys(t *testing.T) {
	stored := map[string]any{"host": "smtp.example.com", "port": float64(587), "password": "pw"}
	got := MergeConfig(stored, map[string]any{"port": float64(465)})
	if got["host"] != "smtp.example.com" || got["password"] != "pw" {
		t.Fatalf("fields not mentioned should be kept, got %v", got)
	}
	if got["port"] != float64(465) {
		t.Fatalf("mentioned fields should be updated, got %v", got["port"])
	}
}

// TestPrepareConfigUpdateBlocksDestinationSwap is this package's most important security invariant:
// **changing the destination must not carry the old credentials along**.
//
// These cases use exactly attack-shaped input (change only the address, stay silent about the credentials),
// not "the correct input for the defence logic"; testing only the latter would stay all green even if the defence did not work.
func TestPrepareConfigUpdateBlocksDestinationSwap(t *testing.T) {
	cases := []struct {
		name     string
		kind     string
		stored   map[string]any
		incoming map[string]any
		// wantMissing is the credential key expected to be named.
		wantMissing string
	}{
		{
			name: "generic webhook changes the address hoping to reuse the Authorization header",
			kind: KindWebhook,
			stored: map[string]any{
				"url":     "https://legit.example.com/hook",
				"headers": map[string]any{"Authorization": "Bearer REAL-TOKEN"},
			},
			incoming:    map[string]any{"url": "https://attacker.tld/c"},
			wantMissing: "headers",
		},
		{
			name:        "Telegram changes base_url hoping to send the bot token to its own endpoint",
			kind:        KindTelegram,
			stored:      map[string]any{"bot_token": "123456:REAL", "chat_id": "1", "base_url": "https://api.telegram.org"},
			incoming:    map[string]any{"base_url": "https://attacker.tld"},
			wantMissing: "bot_token",
		},
		{
			name:        "email changes the SMTP host hoping to get the password handed over",
			kind:        KindEmail,
			stored:      map[string]any{"host": "smtp.corp.com", "port": 587, "password": "REALPW", "from": "a@b.c", "to": []any{"d@e.f"}},
			incoming:    map[string]any{"host": "smtp.attacker.tld"},
			wantMissing: "password",
		},
		{
			name:        "turning off TLS for email also requires restating the password",
			kind:        KindEmail,
			stored:      map[string]any{"host": "smtp.corp.com", "port": 587, "tls": false, "password": "REALPW", "from": "a@b.c", "to": []any{"d@e.f"}},
			incoming:    map[string]any{"tls": true},
			wantMissing: "password",
		},
		{
			// A masked value = "reuse the old credential", which must likewise be rejected when the address changes.
			name:        "masked credential echoed back + new address",
			kind:        KindTelegram,
			stored:      map[string]any{"bot_token": "123456:REAL", "chat_id": "1", "base_url": "https://api.telegram.org"},
			incoming:    map[string]any{"base_url": "https://attacker.tld", "bot_token": MaskedValue("123456:REAL")},
			wantMissing: "bot_token",
		},
		{
			name:        "DingTalk changes the webhook hoping to reuse the signing secret",
			kind:        KindDingTalk,
			stored:      map[string]any{"webhook": "https://oapi.dingtalk.com/robot/send?access_token=OLD", "secret": "REALSEC"},
			incoming:    map[string]any{"webhook": "https://attacker.tld/hook"},
			wantMissing: "secret",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			merged, err := PrepareConfigUpdate(tc.kind, tc.stored, tc.incoming)
			if err == nil {
				t.Fatalf("changing the address without restating the credentials should be rejected; got config %v", merged)
			}
			var target *ErrDestinationChangedWithoutCredentials
			if !errors.As(err, &target) {
				t.Fatalf("a dedicated error type should be returned so the API can give an actionable hint, got %T: %v", err, err)
			}
			found := false
			for _, m := range target.Missing {
				if m == tc.wantMissing {
					found = true
				}
			}
			if !found {
				t.Fatalf("the missing credential key %q should be named, got %v", tc.wantMissing, target.Missing)
			}
			// The error message must tell the operator how to fix it.
			if !strings.Contains(err.Error(), tc.wantMissing) {
				t.Errorf("the error message should mention %q: %v", tc.wantMissing, err)
			}
		})
	}
}

// TestPrepareConfigUpdateAllowsLegitimateEdits is the reverse case: normal edits must not be blocked by mistake,
// otherwise this protection would get bypassed or removed for being "too annoying".
func TestPrepareConfigUpdateAllowsLegitimateEdits(t *testing.T) {
	cases := []struct {
		name     string
		kind     string
		stored   map[string]any
		incoming map[string]any
	}{
		{
			name:     "only the name changes (config echoed back unchanged)",
			kind:     KindWebhook,
			stored:   map[string]any{"url": "https://legit.example.com/hook", "headers": map[string]any{"Authorization": "Bearer REAL"}},
			incoming: map[string]any{"url": MaskedValue("https://legit.example.com/hook")},
		},
		{
			name:     "only the request method changes, address and credentials untouched",
			kind:     KindWebhook,
			stored:   map[string]any{"url": "https://legit.example.com/hook", "method": "POST"},
			incoming: map[string]any{"method": "PUT"},
		},
		{
			name:     "address changed **together with** new credentials",
			kind:     KindWebhook,
			stored:   map[string]any{"url": "https://old.example.com/hook", "headers": map[string]any{"Authorization": "Bearer OLD"}},
			incoming: map[string]any{"url": "https://new.example.com/hook", "headers": map[string]any{"Authorization": "Bearer NEW"}},
		},
		{
			name:     "address changed and credentials explicitly declared no longer needed",
			kind:     KindWebhook,
			stored:   map[string]any{"url": "https://old.example.com/hook", "headers": map[string]any{"Authorization": "Bearer OLD"}},
			incoming: map[string]any{"url": "https://new.example.com/hook", "headers": ""},
		},
		{
			name:     "Telegram changes chat_id (not a destination)",
			kind:     KindTelegram,
			stored:   map[string]any{"bot_token": "t", "chat_id": "1", "base_url": "https://api.telegram.org"},
			incoming: map[string]any{"chat_id": "-100200"},
		},
		{
			name:     "email changes recipients (not a destination)",
			kind:     KindEmail,
			stored:   map[string]any{"host": "smtp.corp.com", "port": 587, "password": "PW", "from": "a@b.c", "to": []any{"x@y.z"}},
			incoming: map[string]any{"to": []any{"new@y.z"}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			merged, err := PrepareConfigUpdate(tc.kind, tc.stored, tc.incoming)
			if err != nil {
				t.Fatalf("legitimate edit blocked by mistake: %v", err)
			}
			if merged == nil {
				t.Fatal("a merged result should be returned")
			}
		})
	}
}

// TestPrepareConfigUpdatePortTypeTolerance covers an easily misjudged detail:
// the frontend submits the port as a JSON number (float64), and it also reads back from the database as float64,
// but the two values may have different types (e.g. int vs float64). Comparing with == would judge "unchanged" as "changed",
// and pop up "please re-enter the password" for a user who only changed the name; false alarms make people stop trusting this protection.
func TestPrepareConfigUpdatePortTypeTolerance(t *testing.T) {
	stored := map[string]any{"host": "smtp.corp.com", "port": float64(587), "password": "PW"}
	// The same port, submitted as an int.
	if _, err := PrepareConfigUpdate(KindEmail, stored, map[string]any{"port": 587}); err != nil {
		t.Fatalf("the same port value (differing only in type) should not count as a destination change: %v", err)
	}
	// A real port change must be blocked.
	if _, err := PrepareConfigUpdate(KindEmail, stored, map[string]any{"port": 25}); err == nil {
		t.Fatal("a port change should be blocked")
	}
}

// TestPrepareConfigUpdateSurvivesRepeatedSaveWithBlankDestination covers the "destination field that may be left empty"
// path: an empty Telegram base_url means the official API address.
//
// This used to make a channel fail every save from the second one onward:
//
//	base_url:"" stored on create (the create path stores the frontend's config directly, without MergeConfig)
//	→ first save: MergeConfig treats the empty string as an explicit clear and deletes the key
//	→ second save: incoming is still "" while stored no longer has the key, judged as "address changed"
//	→ bot_token is the masked echo value → 400 "the destination has changed; re-enter the credential fields"
//
// The user changed nothing, yet could never save again unless they pasted the bot token once more.
func TestPrepareConfigUpdateSurvivesRepeatedSaveWithBlankDestination(t *testing.T) {
	stored := map[string]any{"bot_token": "123:ABC", "chat_id": "-100", "base_url": ""}

	// The frontend buildConfig() submits a value for every field definition of the channel: credentials are filled back with masks,
	// empty text boxes submit empty strings. This reproduces its output in full rather than submitting only "changed keys".
	submit := func() map[string]any {
		return map[string]any{
			"bot_token": MaskedValue("123:ABC"),
			"chat_id":   "-100",
			"base_url":  "",
		}
	}

	// First save: only the channel name changed, config echoed back unchanged.
	merged, err := PrepareConfigUpdate(KindTelegram, stored, submit())
	if err != nil {
		t.Fatalf("first save blocked by mistake: %v", err)
	}
	if _, ok := merged["base_url"]; ok {
		t.Fatal("precondition changed: the empty string should be deleted by MergeConfig; this case covers exactly the step \"after the key disappears\"")
	}

	// Second save: the submission is identical to last time; the user changed nothing.
	merged2, err := PrepareConfigUpdate(KindTelegram, merged, submit())
	if err != nil {
		t.Fatalf("second save blocked by mistake (the user changed nothing): %v", err)
	}
	// A third time, to confirm it is not "wrong just once" but stably savable.
	if _, err := PrepareConfigUpdate(KindTelegram, merged2, submit()); err != nil {
		t.Fatalf("third save blocked by mistake: %v", err)
	}
	// The credential must be kept all the way through, not cleared along with the empty-string logic.
	if got := merged2["bot_token"]; got != "123:ABC" {
		t.Fatalf("the bot token should keep its original value, got %v", got)
	}
}

// TestPrepareConfigUpdateStillGuardsBlankDestinationChanges is the paired
// assertion of the previous case: treating an empty string and "key absent" as equivalent must **not** let real destination changes through.
// Both directions are real credential exfiltration paths: Telegram's bot token travels in the URL path,
// so changing base_url means sending the token to the new address.
func TestPrepareConfigUpdateStillGuardsBlankDestinationChanges(t *testing.T) {
	// Direction one: from "empty" (the official address) to a self-hosted address.
	official := map[string]any{"bot_token": "123:ABC", "chat_id": "-100"}
	if _, err := PrepareConfigUpdate(KindTelegram, official, map[string]any{
		"bot_token": MaskedValue("123:ABC"),
		"base_url":  "https://tg-proxy.attacker.tld",
	}); err == nil {
		t.Fatal("switching from the official address to a self-hosted one must require re-entering the token")
	}

	// Direction two: clearing the self-hosted address (= switching back to the official API) is also a destination change.
	proxied := map[string]any{"bot_token": "123:ABC", "base_url": "https://proxy.internal/bot"}
	if _, err := PrepareConfigUpdate(KindTelegram, proxied, map[string]any{
		"bot_token": MaskedValue("123:ABC"),
		"base_url":  "",
	}); err == nil {
		t.Fatal("clearing the self-hosted address (switching back to the official API) is also a destination change and must require re-entering the token")
	}
}

func TestDestinationKeysDeclaredForEveryKind(t *testing.T) {
	// Same as SecretKeys: if a channel forgets to declare its destination keys, PrepareConfigUpdate cannot protect them.
	for kind, ch := range registry {
		if len(ch.DestinationKeys()) == 0 {
			t.Errorf("channel %s declares no destination keys; the protection against address changes leaking credentials does not cover it", kind)
		}
		if len(ch.SecretKeys()) == 0 {
			t.Errorf("channel %s declares no credential keys", kind)
		}
	}
}

func TestSecretKeysDeclaredForEveryKind(t *testing.T) {
	// The compiler already forces every channel to implement SecretKeys; this double-checks that "no channel hands in a blank sheet
	// on masking": a channel returning an empty slice means its credentials would be echoed to the browser in plaintext.
	expect := map[string]bool{
		KindDingTalk: true, KindFeishu: true, KindWeCom: true,
		KindWebhook: true, KindTelegram: true, KindEmail: true,
	}
	for kind, ch := range registry {
		if !expect[kind] {
			t.Errorf("channel %s has no masking expectation registered in the test", kind)
			continue
		}
		if len(ch.SecretKeys()) == 0 {
			t.Errorf("channel %s declares no credential fields; its config would be echoed in plaintext", kind)
		}
	}
}

// TestPrepareConfigUpdateRejectsMaskedInContainer covers a gap pointed out by the audit:
// when the mask sentinel is put inside a **non-string** structure (e.g. webhook.headers is an object),
// MergeConfig only treats "a string with the prefix" as masked, so the literal "__masked__" would be stored as
// a real header value: later auth silently fails, with no error at all.
func TestPrepareConfigUpdateRejectsMaskedInContainer(t *testing.T) {
	stored := map[string]any{
		"url":     "https://legit.example.com/hook",
		"headers": map[string]any{"Authorization": "Bearer REAL"},
	}
	// Mask sentinel smuggled inside an object.
	incoming := map[string]any{
		"headers": map[string]any{"Authorization": MaskedPrefix},
	}
	if _, err := PrepareConfigUpdate(KindWebhook, stored, incoming); err == nil {
		t.Fatal("a mask sentinel inside a structure should be rejected (otherwise the literal is stored in the database)")
	}
	// Submitting the whole object (a real new value) is accepted as usual.
	ok := map[string]any{"headers": map[string]any{"Authorization": "Bearer NEW"}}
	if _, err := PrepareConfigUpdate(KindWebhook, stored, ok); err != nil {
		t.Fatalf("a normal submission of new request headers should not be blocked: %v", err)
	}
}
