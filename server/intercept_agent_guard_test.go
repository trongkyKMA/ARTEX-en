package server

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/guard"
	"github.com/Autumn-27/artex/intercept"
)

// The planner and main agent get the task's Guard through guardedAgentCtx, and
// Monitor, MCP tools and user-defined tools are gated like Bash. A [builtin][no-change] rule blocks while enabled and
// lets the call through once disabled (judge off: nothing else decides).
func TestTaskGuardGatesMonitorAndRuleToggle(t *testing.T) {
	dsn, _, err := db.DSN()
	if err != nil {
		t.Skip("no test database configured")
	}
	d, err := db.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	restoreSetting := func(key string) {
		val, ok, _ := d.GetSetting(key)
		t.Cleanup(func() {
			if ok {
				_ = d.SetSetting(key, val)
			} else {
				_, _ = d.Exec(`DELETE FROM settings WHERE key=$1`, key)
			}
		})
	}
	restoreSetting("intercept_enabled_tools")
	restoreSetting("llm_judge_enabled")
	if _, err := d.Exec(`DELETE FROM settings WHERE key='intercept_enabled_tools'`); err != nil { // code default
		t.Fatal(err)
	}
	if err := d.SetBool("llm_judge_enabled", false); err != nil {
		t.Fatal(err)
	}
	const ruleName = "[builtin][no-change] Change account passwords"
	setRule := func(on bool) {
		if _, err := d.Exec(`UPDATE intercept_rules SET enabled=$1 WHERE name=$2`, on, ruleName); err != nil {
			t.Fatal(err)
		}
	}
	setRule(true)
	t.Cleanup(func() { setRule(true) })

	ic := intercept.New(d)
	task := &Task{ID: "agent-guard-test", Guard: guard.NewWithInterceptor(ic)}
	if ctx := guardedAgentCtx(context.Background(), task, "planner", func(db.Activity) {}); ctx == context.Background() {
		t.Fatal("guardedAgentCtx must attach the task's hooks")
	}
	if ctx := guardedAgentCtx(context.Background(), &Task{}, "planner", func(db.Activity) {}); ctx != context.Background() {
		t.Fatal("a task without a Guard must leave ctx unchanged")
	}
	hooks := task.Guard.Hooks()
	blocked := func(tool, cmd string) bool {
		in, _ := json.Marshal(map[string]string{"command": cmd})
		b, _, _ := hooks.PreToolUse(context.Background(), tool, in)
		return b
	}

	for _, tool := range []string{"Bash", "Monitor"} {
		if !blocked(tool, "passwd admin") {
			t.Errorf("%s: password change must be blocked while the rule is on", tool)
		}
		if blocked(tool, "nmap -sV 10.0.0.0/24") {
			t.Errorf("%s: a scan must not be blocked", tool)
		}
	}

	// MCP tools and user-defined tools are gated too; read-only SDK tools are not.
	const customKey = "zz_guard_test_runner"
	if err := d.CreateCustomTool(&db.Tool{Key: customKey, Kind: "command", Enabled: true,
		Exec: json.RawMessage(`{"command":"{args}"}`)}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.DeleteCustomTool(customKey) })
	for _, tool := range []string{"mcp__ssh__exec", customKey} {
		if !blocked(tool, "passwd admin") {
			t.Errorf("%s: password change must be blocked", tool)
		}
	}
	if blocked("Read", "passwd admin") {
		t.Error("Read is not in the intercept list and must not be blocked")
	}

	setRule(false)
	ic.Invalidate() // what the rule toggle endpoint does
	for _, tool := range []string{"Bash", "Monitor"} {
		if blocked(tool, "passwd admin") {
			t.Errorf("%s: with the rule off and the judge off the call must pass", tool)
		}
	}
}
