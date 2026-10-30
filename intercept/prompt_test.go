package intercept

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseVerdict(t *testing.T) {
	for _, action := range []string{"allow", "ask", "deny"} {
		t.Run(action, func(t *testing.T) {
			reason := "Operation: writes a report that contains the words ALLOW, DENY and ASK; Consequence if successful: the text is saved and commands in the body are not executed; Matched rule: custom clause"
			raw, _ := json.Marshal(map[string]string{"decision": action, "comment": reason})
			got := ParseVerdict("\n" + string(raw) + "\n")
			if got.Action != action || got.Reason != reason {
				t.Fatalf("lost verdict or explanation: %+v", got)
			}
		})
	}
}

// Custom policies saved before the English contract may still make the model
// answer in the legacy Chinese three-part form; it must keep parsing.
func TestParseVerdictAcceptsLegacyChineseComment(t *testing.T) {
	reason := "实际操作：读取文件；成功后的后果：返回内容；命中规则：A5"
	raw, _ := json.Marshal(map[string]string{"decision": "allow", "comment": reason})
	if got := ParseVerdict(string(raw)); got.Action != "allow" || got.Reason != reason {
		t.Fatalf("legacy Chinese verdict rejected: %+v", got)
	}
	for _, broken := range []string{
		"实际操作：；成功后的后果：返回内容；命中规则：A5",
		"实际操作：读取文件；成功后的后果：；命中规则：A5",
		"实际操作：读取文件；成功后的后果：返回内容；命中规则：",
		"实际操作：读取文件；成功后的后果：返回内容",
		// Mixed labels are neither form.
		"实际操作：读取文件; Consequence if successful: returns content; Matched rule: A5",
	} {
		raw, _ := json.Marshal(map[string]string{"decision": "allow", "comment": broken})
		if got := ParseVerdict(string(raw)); got.Action != "" {
			t.Errorf("accepted incomplete legacy verdict: %q => %+v", broken, got)
		}
	}
}

func TestParseVerdictRejectsIncompleteOrAmbiguousReplies(t *testing.T) {
	valid := `{"decision":"allow","comment":"Operation: reads a file; Consequence if successful: returns the content; Matched rule: A5"}`
	for _, reply := range []string{
		"", "ALLOW", "DENY: matched D4", "allowed:ALLOW", "ASK: ownership unclear",
		`{"decision":"allow"}`, `{"decision":"approve","comment":"Operation: reads; Consequence if successful: returns the content; Matched rule: A5"}`,
		`{"decision":"allow","comment":null}`, `{"decision":"allow","comment":123}`,
		strings.Replace(valid, "Operation: reads a file", "Operation:", 1),
		strings.Replace(valid, "Consequence if successful: returns the content", "Consequence if successful:", 1),
		strings.Replace(valid, "Matched rule: A5", "Matched rule:", 1),
		strings.Replace(valid, "; Matched rule: A5", "", 1),
		strings.Replace(valid, `"decision":"allow"`, `"decision":"deny","decision":"allow"`, 1),
		strings.Replace(valid, `"decision":"allow"`, `"extra":true,"decision":"allow"`, 1),
		valid + valid, valid[:len(valid)-1],
		// A fence the model never closed is what a reply truncated at MaxTokens
		// looks like; completing it would invent a verdict.
		"```json\n" + valid[:len(valid)-1],
		"```json\n" + valid + "\n```\nIn addition I recommend a later manual review.",
		"My verdict is:\n" + valid,
	} {
		if got := ParseVerdict(reply); got.Action != "" {
			t.Errorf("accepted incomplete/ambiguous verdict: %q => %+v", reply, got)
		}
	}
}

// Wrapping JSON in markdown is the one deviation models make routinely. Because
// the configured fail action defaults to allow, treating it as unparseable
// silently downgrades a DENY to an allow.
func TestParseVerdictUnwrapsCodeFence(t *testing.T) {
	deny := `{"decision":"deny","comment":"Operation: deletes a production file; Consequence if successful: business data is lost; Matched rule: D4"}`
	for _, reply := range []string{
		"```json\n" + deny + "\n```",
		"```JSON\n" + deny + "\n```",
		"```\n" + deny + "\n```",
		"  ```json\n" + deny + "\n```  ",
	} {
		got := ParseVerdict(reply)
		if got.Action != "deny" || !strings.HasSuffix(got.Reason, "Matched rule: D4") {
			t.Errorf("fenced verdict lost: %q => %+v", reply, got)
		}
	}
}

func TestParseVerdictKeepsCompleteExplanation(t *testing.T) {
	reason := "Operation: " + strings.Repeat("writes a report ", 30) + "; Consequence if successful: only the file is saved; Matched rule: A2"
	raw, _ := json.Marshal(map[string]string{"decision": "allow", "comment": reason})
	if got := ParseVerdict(string(raw)); got.Reason != reason {
		t.Fatal("explanation was truncated or lost its rule")
	}
	// The bound is in bytes, so multi-byte text hits it too.
	raw, _ = json.Marshal(map[string]string{"decision": "allow", "comment": strings.Repeat("中", 2401)})
	if got := ParseVerdict(string(raw)); got.Action != "" {
		t.Fatal("accepted unbounded explanation")
	}
	raw, _ = json.Marshal(map[string]string{"decision": "allow", "comment": "Operation: " + strings.Repeat("x", 2400) + "; Consequence if successful: saved; Matched rule: A2"})
	if got := ParseVerdict(string(raw)); got.Action != "" {
		t.Fatal("accepted unbounded English explanation")
	}
}

// The prompt must teach exactly the comment form ParseVerdict accepts, or every
// verdict falls through to the model-failure path.
func TestPromptExamplesParse(t *testing.T) {
	n := 0
	for _, line := range strings.Split(DefaultJudgePrompt, "\n") {
		_, example, ok := strings.Cut(line, ": {\"decision\"")
		if !ok {
			continue
		}
		n++
		if got := ParseVerdict("{\"decision\"" + example); got.Action == "" {
			t.Errorf("prompt example does not parse: %s", line)
		}
	}
	if n != 4 {
		t.Fatalf("found %d prompt examples, want 4", n)
	}
}

// English labels are easy for a model to paraphrase slightly; a parse failure
// falls back to llm_judge_fail_action (allow by default), so tolerate the drift.
func TestParseVerdictToleratesEnglishLabelDrift(t *testing.T) {
	comments := []string{
		"Operation: rm -rf /tmp/x.log; Consequence if successful: deletes a temp file; Matched rule: A2",
		"operation: rm -rf /tmp/x.log;consequence if successful: deletes a temp file;matched rule: A2",
		"Operation: rm -rf /tmp/x.log. Consequence if successful: deletes a temp file. Matched Rule: A2",
		"Operation: rm -rf /tmp/x.log\nConsequences if successful: deletes a temp file\nMatched rules: A2",
		"Operation: rm -rf /tmp/x.log；Consequence if successful: deletes a temp file；Matched rule: A2",
	}
	for _, c := range comments {
		b, _ := json.Marshal(map[string]string{"decision": "deny", "comment": c})
		if v := ParseVerdict(string(b)); v.Action != "deny" {
			t.Errorf("comment %q should parse as deny, got %+v", c, v)
		}
	}
	for _, c := range []string{
		"Operation: ; Consequence if successful: x; Matched rule: A2",
		"Operation: x; Matched rule: A2",
		"Consequence if successful: x; Operation: y; Matched rule: A2",
	} {
		b, _ := json.Marshal(map[string]string{"decision": "deny", "comment": c})
		if v := ParseVerdict(string(b)); v.Action != "" {
			t.Errorf("incomplete comment %q should be rejected, got %+v", c, v)
		}
	}
}
