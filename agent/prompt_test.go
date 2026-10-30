package agent

import (
	"strings"
	"testing"
)

func TestRenderSystemOverrideAndFallback(t *testing.T) {
	t.Cleanup(func() { PromptOverride = nil })

	// no override → built-in default
	PromptOverride = nil
	if got := renderBody("planner", "DEFAULT", PlannerVars{Goal: "g"}); got != "DEFAULT" {
		t.Fatalf("no override should give default, got %q", got)
	}

	// override → rendered with vars
	PromptOverride = func(k string) (string, bool) {
		if k == "planner" {
			return "Goal:{{.Goal}} Scope:{{.Scope}}", true
		}
		return "", false
	}
	if got := renderBody("planner", "DEFAULT", PlannerVars{Goal: "pwn X", Scope: "*.x.com"}); got != "Goal:pwn X Scope:*.x.com" {
		t.Fatalf("override render: %q", got)
	}

	// override referencing a non-catalog var → execution error → fallback to default
	PromptOverride = func(k string) (string, bool) { return "{{.NotInCatalog}}", true }
	if got := renderBody("planner", "DEFAULT", PlannerVars{Goal: "x"}); got != "DEFAULT" {
		t.Fatalf("bad var should fall back to default, got %q", got)
	}

	// full plannerSystem path: DB body [A] is honored, then the code-owned tail
	// [C] (intermediate-artifact output rules) is ALWAYS appended — editing the body can't drop it.
	PromptOverride = func(k string) (string, bool) { return "PLANNER {{.Goal}}", true }
	got := plannerSystem("pwn X", "/data", "/data")
	if !strings.HasPrefix(got, "PLANNER pwn X") {
		t.Fatalf("plannerSystem body not honored: %q", got)
	}
	if !strings.Contains(got, "Intermediate artifact output rules") || !strings.Contains(got, "/data") {
		t.Fatalf("plannerSystem missing code-owned artifact tail: %q", got)
	}

	// worker dual-text via {{if .ProxyAddr}} in a user template, plus the code tail:
	// [B] trafficTool present only when RECORDING (caCert set — the MITM is on, so
	// the traffic_* tools exist), [C] artifact spec always present. The trafficTool
	// block is gated on the CA (arg 2), NOT on ProxyAddr — a global egress proxy
	// with capture off routes traffic but records nothing.
	PromptOverride = func(k string) (string, bool) {
		return "{{if .ProxyAddr}}via proxy {{.ProxyAddr}}{{else}}manual{{end}}", true
	}
	recording := workerSystem("127.0.0.1:8080", "/ca.pem", "/data", "/data")
	if !strings.HasPrefix(recording, "via proxy 127.0.0.1:8080") {
		t.Fatalf("worker proxy branch body: %q", recording)
	}
	if !strings.Contains(recording, "traffic_search") {
		t.Fatalf("worker while recording should inject trafficTool: %q", recording)
	}
	if strings.Contains(recording, "traffic_refs") {
		t.Fatalf("worker bypassed shared optional evidence policy: %q", recording)
	}
	if !strings.Contains(recording, "Intermediate artifact output rules") {
		t.Fatalf("worker missing artifact tail: %q", recording)
	}
	// Egress proxy set but capture OFF (no CA): the ProxyAddr template branch still
	// renders, but the trafficTool block must NOT — those tools are not registered.
	egressOnly := workerSystem("127.0.0.1:8080", "", "/data", "/data")
	if !strings.HasPrefix(egressOnly, "via proxy 127.0.0.1:8080") {
		t.Fatalf("worker egress-only branch body: %q", egressOnly)
	}
	if strings.Contains(egressOnly, "traffic_search") {
		t.Fatalf("worker without recording must NOT inject trafficTool: %q", egressOnly)
	}
	noProxy := workerSystem("", "", "/data", "/data")
	if !strings.HasPrefix(noProxy, "manual") {
		t.Fatalf("worker no-proxy branch body: %q", noProxy)
	}
	if strings.Contains(noProxy, "traffic_search") {
		t.Fatalf("worker without proxy must NOT inject trafficTool: %q", noProxy)
	}
}

func TestRenderSystemOutputLanguage(t *testing.T) {
	t.Cleanup(func() { PromptOverride = nil; OutputLanguage = nil })
	PromptOverride = func(string) (string, bool) { return "BODY Write everything in English", true }

	// unset / en (the default) → English directive after the body, so a task written in
	// Chinese still gets English output
	for _, lang := range []func() string{nil, func() string { return "en" }, func() string { return "bogus" }} {
		OutputLanguage = lang
		if got := renderSystem("reporter", "DEFAULT", chatVars{}); got != "BODY Write everything in English"+englishOutputDirective {
			t.Fatalf("en should append the English directive, got %q", got)
		}
	}
	OutputLanguage = nil
	if !strings.Contains(plannerSystem("g", "/data", "/data"), englishOutputDirective) {
		t.Fatal("planner system prompt is missing the English directive")
	}

	// zh → Chinese directive appended after the (user-edited) body so it overrides "Write everything in English"
	OutputLanguage = func() string { return "zh" }
	got := renderSystem("reporter", "DEFAULT", chatVars{})
	if !strings.HasPrefix(got, "BODY Write everything in English") || !strings.HasSuffix(got, chineseOutputDirective) {
		t.Fatalf("zh should append the Chinese directive after the body, got %q", got)
	}
	if !strings.HasPrefix(chineseOutputDirective, "\n\n**输出语言") {
		t.Fatalf("Chinese directive changed: %q", chineseOutputDirective)
	}
	if !strings.Contains(plannerSystem("g", "/data", "/data"), chineseOutputDirective) {
		t.Fatal("planner system prompt is missing the Chinese directive")
	}
}
