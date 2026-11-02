package agent

import (
	"context"

	"github.com/Autumn-27/norma/harness"
)

type toolHooksKey struct{}

// WithToolHooks attaches a task's tool-call hooks (its Guard: intercept rules and the
// LLM judge) to ctx. The planner and main agent read them in Plan / Chat. They have
// Bash, Write and Monitor too, and without these hooks their calls skipped every
// intercept rule a worker's calls go through. A nil h leaves ctx unchanged.
func WithToolHooks(ctx context.Context, h harness.HookRunner) context.Context {
	if h == nil {
		return ctx
	}
	return context.WithValue(ctx, toolHooksKey{}, h)
}

// toolHooksFrom returns the hooks attached by WithToolHooks, or nil.
func toolHooksFrom(ctx context.Context) harness.HookRunner {
	h, _ := ctx.Value(toolHooksKey{}).(harness.HookRunner)
	return h
}
