package db

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestContainsHan(t *testing.T) {
	for s, want := range map[string]bool{
		"[内置] 递归强制删除":            true,
		"Recursive force delete": false,
		"rm -rf / （全角括号）":        true,
		"（）":                     false, // full-width punctuation alone is not Chinese text
		"":                       false,
	} {
		if got := ContainsHan(s); got != want {
			t.Errorf("ContainsHan(%q) = %v, want %v", s, got, want)
		}
	}
}

// A database seeded by an upstream (Chinese) build: built-in rows still in Chinese are rewritten to
// English, rows a user edited in English are left alone.
func TestLocalizeBuiltinRuleSeeds(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	v1 := defaultInterceptRulesV1[0]
	zh, err := d.CreateInterceptRule("[内置] 递归强制删除 rm -rf", v1.target, v1.typ, v1.pattern, v1.action, "禁止递归强制删除", 100, true, false, 60, "deny")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.Exec(`DELETE FROM intercept_rules WHERE id=$1`, zh.ID) })
	en, err := d.CreateInterceptRule("my own wording", v1.target, v1.typ, v1.pattern, v1.action, "edited in English", 100, true, false, 60, "deny")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.Exec(`DELETE FROM intercept_rules WHERE id=$1`, en.ID) })

	if err := d.localizeBuiltinRuleSeeds(); err != nil {
		t.Fatal(err)
	}
	var name, msg string
	if err := d.QueryRow(`SELECT name, message FROM intercept_rules WHERE id=$1`, zh.ID).Scan(&name, &msg); err != nil {
		t.Fatal(err)
	}
	if name != v1.name || msg != v1.message {
		t.Errorf("Chinese built-in rule not localized: %q / %q", name, msg)
	}
	if err := d.QueryRow(`SELECT name, message FROM intercept_rules WHERE id=$1`, en.ID).Scan(&name, &msg); err != nil {
		t.Fatal(err)
	}
	if name != "my own wording" || msg != "edited in English" {
		t.Errorf("English rule must not change, got %q / %q", name, msg)
	}
}

func TestSeedToolReplacesOnlyChineseSystemRows(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	key := "zz_localize_" + strings.ToLower(t.Name())
	t.Cleanup(func() { _, _ = d.Exec(`DELETE FROM tools WHERE key=$1`, key) })

	zhSchema := json.RawMessage(`{"type":"object","properties":{"q":{"type":"string","description":"查询词"}}}`)
	enSchema := json.RawMessage(`{"type":"object","properties":{"q":{"type":"string","description":"query"}}}`)
	agents := json.RawMessage(`["worker"]`)
	if err := d.SeedTool(key, "查询工具", zhSchema, agents); err != nil {
		t.Fatal(err)
	}
	// Bindings changed by the user must survive the rewrite.
	if _, err := d.Exec(`UPDATE tools SET agents='["planner"]', enabled=false WHERE key=$1`, key); err != nil {
		t.Fatal(err)
	}
	if err := d.SeedTool(key, "Query tool", enSchema, agents); err != nil {
		t.Fatal(err)
	}
	var desc, schema, gotAgents string
	var enabled bool
	if err := d.QueryRow(`SELECT description, schema::text, agents::text, enabled FROM tools WHERE key=$1`, key).Scan(&desc, &schema, &gotAgents, &enabled); err != nil {
		t.Fatal(err)
	}
	if desc != "Query tool" || ContainsHan(schema) {
		t.Errorf("Chinese system tool not localized: %q %s", desc, schema)
	}
	if gotAgents != `["planner"]` || enabled {
		t.Errorf("bindings/enabled must be kept, got %s enabled=%v", gotAgents, enabled)
	}

	// An English edit is never overwritten.
	if _, err := d.Exec(`UPDATE tools SET description='Edited by the user' WHERE key=$1`, key); err != nil {
		t.Fatal(err)
	}
	if err := d.SeedTool(key, "Query tool", enSchema, agents); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(`SELECT description FROM tools WHERE key=$1`, key).Scan(&desc); err != nil {
		t.Fatal(err)
	}
	if desc != "Edited by the user" {
		t.Errorf("English edit overwritten: %q", desc)
	}
}

func TestReplaceChinesePromptKeepsHistory(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	a, err := d.CreateAgent("zz_localize_prompt", "Localize fixture", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.Exec(`UPDATE agents SET current_prompt_id=NULL WHERE id=$1`, a.ID)
		_, _ = d.Exec(`DELETE FROM agent_prompts WHERE agent_id=$1`, a.ID)
		_, _ = d.Exec(`DELETE FROM agents WHERE id=$1`, a.ID)
	})
	if _, err := d.SavePrompt(a.ID, "你是一个渗透测试助手。", legacyPromptNote, "system"); err != nil {
		t.Fatal(err)
	}
	replaced, err := d.ReplaceChinesePrompt(a.ID, "You are a pentest assistant.")
	if err != nil || !replaced {
		t.Fatalf("replaced=%v err=%v", replaced, err)
	}
	if cur, _ := d.CurrentPrompt(a.ID); cur != "You are a pentest assistant." {
		t.Errorf("current prompt = %q", cur)
	}
	var versions int
	if err := d.QueryRow(`SELECT count(*) FROM agent_prompts WHERE agent_id=$1`, a.ID).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 2 {
		t.Errorf("old version must stay in history, got %d versions", versions)
	}
	if again, err := d.ReplaceChinesePrompt(a.ID, "You are a pentest assistant."); err != nil || again {
		t.Errorf("second run must be a no-op: replaced=%v err=%v", again, err)
	}
	if err := d.LocalizePromptNotes(); err != nil {
		t.Fatal(err)
	}
	var legacy int
	if err := d.QueryRow(`SELECT count(*) FROM agent_prompts WHERE agent_id=$1 AND note=$2`, a.ID, legacyPromptNote).Scan(&legacy); err != nil {
		t.Fatal(err)
	}
	if legacy != 0 {
		t.Errorf("legacy note not renamed")
	}
}
