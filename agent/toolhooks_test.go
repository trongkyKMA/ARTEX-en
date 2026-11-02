package agent

import (
	"context"
	"testing"

	"github.com/Autumn-27/norma/hook"
)

func TestToolHooksContext(t *testing.T) {
	ctx := context.Background()
	if WithToolHooks(ctx, nil) != ctx || toolHooksFrom(ctx) != nil {
		t.Fatal("no hooks: ctx must stay unchanged and carry none")
	}
	reg := hook.NewRegistry()
	if got := toolHooksFrom(WithToolHooks(ctx, reg)); got != reg {
		t.Fatalf("hooks not carried: %v", got)
	}
}
