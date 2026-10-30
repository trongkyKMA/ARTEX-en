package server

import (
	"context"
	"errors"
	"iter"
	"testing"

	"github.com/Autumn-27/norma/llm"
)

// judgeProvider records judge requests and, like Claude Opus 5.5 / Sonnet 5.5,
// rejects any request that tries to disable thinking.
type judgeProvider struct {
	rejectDisabled bool
	reqs           []llm.CompletionRequest
}

func (p *judgeProvider) Stream(_ context.Context, req llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	p.reqs = append(p.reqs, req)
	return func(yield func(llm.StreamEvent, error) bool) {
		if p.rejectDisabled && req.Thinking == "disabled" {
			yield(llm.StreamEvent{}, errors.New("anthropic: status 400: thinking.type.disabled is not supported for this model"))
			return
		}
		yield(llm.StreamEvent{Type: llm.SETextDelta, Text: `{"decision":"allow"}`}, nil)
	}
}

func (p *judgeProvider) Complete(context.Context, llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	return llm.Message{}, "", llm.Usage{}, errors.New("not used")
}

func TestJudgeRequestSendsNoTemperature(t *testing.T) {
	p := &judgeProvider{}
	got, err := streamCollectText(context.Background(), p, "sys", "user")
	if err != nil || got != `{"decision":"allow"}` {
		t.Fatalf("got %q, %v", got, err)
	}
	if len(p.reqs) != 1 {
		t.Fatalf("expected a single request, got %d", len(p.reqs))
	}
	if p.reqs[0].Temperature != nil {
		t.Fatal("judge request must not send temperature (rejected by Claude Opus 4.7+ and OpenAI reasoning models)")
	}
	if p.reqs[0].Thinking != "disabled" {
		t.Fatalf("first attempt should disable thinking, got %q", p.reqs[0].Thinking)
	}
}

func TestJudgeRequestRetriesWhenThinkingCannotBeDisabled(t *testing.T) {
	p := &judgeProvider{rejectDisabled: true}
	got, err := streamCollectText(context.Background(), p, "sys", "user")
	if err != nil || got != `{"decision":"allow"}` {
		t.Fatalf("retry should succeed, got %q, %v", got, err)
	}
	if len(p.reqs) != 2 {
		t.Fatalf("expected one retry, got %d requests", len(p.reqs))
	}
	if r := p.reqs[1]; r.Thinking != "" || r.MaxTokens <= 1024 || r.Temperature != nil {
		t.Fatalf("retry should use the profile's thinking setting with a larger budget and no temperature: %+v", r)
	}
}
