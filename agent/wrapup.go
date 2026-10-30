package agent

import (
	"strings"

	"github.com/Autumn-27/norma/harness"
)

// Wrap-up prompt (settlement prompt): when an agent is terminated because its TURNS RAN
// OUT (MaxTurns) or it TIMED OUT (run_seconds/MaxDuration), the SDK's settlement phase
// injects this prompt so the agent first persists what it identified but did not write
// back, then outputs a one-sentence summary, instead of leaving things unfinished.
//
// Each agent's wrap-up prompt can be overridden in the admin UI (stored in
// agents.wrapup_prompt); empty = the built-in default here. Only the PROMPT TEXT is
// editable; which tools are disabled and the wrap-up's own turn budget are code-owned policy.

// WrapupOverride, if set, returns the stored wrap-up prompt for an agent key and
// whether a non-empty one exists. Wired by the server to the agents table (like
// PromptOverride for system prompts). nil / empty → the built-in default is used.
var WrapupOverride func(agentKey string) (string, bool)

// WrapupMaxTurnsOverride, if set, returns the admin-configured turn budget for the
// wrap-up phase of an agent and whether a positive one exists. Wired to the agents
// table. nil / ≤0 → the built-in per-agent default (wrapupTurnDefaults) is used.
var WrapupMaxTurnsOverride func(agentKey string) (int, bool)

// Built-in default wrap-up prompts, indexed by agent key. worker reuses the historically
// hard-coded settleWrapUpPrompt (defined in worker.go), planner/mainagent each have their own;
// anything else (custom agents) uses the generic fallback.
var wrapupDefaults = map[string]string{
	"worker":    settleWrapUpPrompt,
	"planner":   plannerWrapUpDefault,
	"mainagent": mainAgentWrapUpDefault,
}

// wrapupTurnDefaults: built-in default turn budget for each agent's wrap-up phase ITSELF
// (overridable from the admin UI with >0). All get 10 turns so wrap-up has enough steps to
// persist results. Anything else uses genericWrapupTurns.
var wrapupTurnDefaults = map[string]int{
	"worker":    10,
	"planner":   10,
	"mainagent": 10,
}

const genericWrapupTurns = 10

const plannerWrapUpDefault = "Your turn budget for this planning round is about to run out — note that only **this round** is ending; the system will wake you up again later to keep planning as the situation changes. The task is not terminating, so you don't need to wrap up the whole plan here. Land the conclusions you have already worked out this round so it isn't wasted, but also **don't force intents just to wrap up** (0 intents this round is still a perfectly normal result): (1) if you have already judged exploration directions that **should be dispatched now**, submit them in one batched add_intent call (don't hold back what you have worked out); (2) for goals that some finding/fact has proven met, call prove_goal to mark them met (don't miss any); (3) if you identified a serial exploit chain that needs to go step by step, record it with TodoWrite so the next wake-up can continue dispatching it. When done, end this round directly; no summary text is needed."

const mainAgentWrapUpDefault = "Your turn budget is about to run out and this interaction is about to end. Don't start any new exploration/operation. **On its own, in one sentence of plain text**, summarize for the user the current progress, the key conclusions, and the suggested next step."

const genericWrapUpDefault = "You are about to be terminated because your budget is exhausted. First write back the results you completed but have not persisted, then **on its own, in one sentence of plain text** summarize what you did and the key conclusions you reached (this sentence is shown as the result of this run)."

// WrapupDefault returns the built-in default wrap-up prompt for an agent key —
// used by the admin UI as the "restore default" value and empty-field placeholder.
func WrapupDefault(agentKey string) string {
	if d, ok := wrapupDefaults[agentKey]; ok {
		return d
	}
	return genericWrapUpDefault
}

// WrapupTurnsDefault returns the built-in wrap-up turn budget for an agent key —
// used by the admin UI as the "0 = default N" hint.
func WrapupTurnsDefault(agentKey string) int {
	if n, ok := wrapupTurnDefaults[agentKey]; ok {
		return n
	}
	return genericWrapupTurns
}

// resolveWrapup returns the effective wrap-up prompt: the DB override (if set and
// non-empty) over the built-in default.
func resolveWrapup(agentKey string) string {
	if WrapupOverride != nil {
		if t, ok := WrapupOverride(agentKey); ok && strings.TrimSpace(t) != "" {
			return t
		}
	}
	return WrapupDefault(agentKey)
}

// resolveWrapupTurns returns the effective wrap-up turn budget: a positive DB
// override over the built-in per-agent default.
func resolveWrapupTurns(agentKey string) int {
	if WrapupMaxTurnsOverride != nil {
		if v, ok := WrapupMaxTurnsOverride(agentKey); ok && v > 0 {
			return v
		}
	}
	return WrapupTurnsDefault(agentKey)
}

// wrapupSettlement builds the settlement config for an agent's run. Prompt and the
// turn budget are admin-editable per agent; disabled tools are code-owned policy so
// a user can't edit away the "stop probing" guardrail. Resolved fresh each run
// (reads DB live), so edits apply on the next run without a restart.
func wrapupSettlement(agentKey string, disabledTools []string) *harness.Settlement {
	return &harness.Settlement{
		Prompt:        resolveWrapup(agentKey),
		DisabledTools: disabledTools,
		MaxTurns:      resolveWrapupTurns(agentKey),
	}
}

// ---------- Task-level timeout wrap-up text (see the task-level timeout and wrap-up design doc under docs/) ----------
//
// This is a SEPARATE SET from the per-run wrap-up text: per-run means "the budget of this
// one run of yours is used up"; task timeout means "the whole task is due and about to end".
// The semantics are often opposite (especially for the planner: per-run says "don't stop,
// keep planning", task timeout says "time is up, stop planning and make the final judgment").
// Configured only for worker/planner.

// WrapupTaskTimeoutOverride / …TurnsOverride: DB overrides of the task-timeout wrap-up text
// and turns (wired to agents.task_timeout_wrapup_prompt / _max_turns, worker/planner only).
var (
	WrapupTaskTimeoutOverride      func(agentKey string) (string, bool)
	WrapupTaskTimeoutTurnsOverride func(agentKey string) (int, bool)
)

var taskTimeoutWrapupDefaults = map[string]string{
	"worker":  workerTaskTimeoutDefault,
	"planner": plannerTaskTimeoutDefault,
}

const workerTaskTimeoutDefault = "**The whole task has reached its timeout limit and is about to end** (not the budget of this run of yours — the entire exploration is out of time). This is the last chance: (1) persist **everything** you identified but have not written back yet — new assets with insert_assets, exploration conclusions/facts with record_fact, confirmed vulnerabilities with report_finding; (2) don't start any new commands/probes; (3) **finally, on its own, in one sentence of plain text** summarize your key conclusions on this intent."

const plannerTaskTimeoutDefault = "**The whole task has reached its timeout limit and is about to end** (not this round — the whole task is terminating). Based on **all** current facts and findings, make one final goal judgment: for goals that evidence has proven met, call prove_goal to mark them met (don't miss any). **Don't generate any new intents** (intents dispatched now will never be executed). Once the judgment is done, wrap up; no summary text is needed."

// TaskTimeoutWrapupDefault returns an agent's built-in default task-timeout wrap-up text (for the admin UI placeholder / restore default).
func TaskTimeoutWrapupDefault(agentKey string) string {
	return taskTimeoutWrapupDefaults[agentKey] // not configured (mainagent/chat) → empty string
}

// resolveTaskTimeoutWrapup: DB override (non-empty) > built-in default. An empty string means
// the agent has no task-timeout text (not worker/planner); the caller should then fall back
// to the per-run text.
func resolveTaskTimeoutWrapup(agentKey string) string {
	if WrapupTaskTimeoutOverride != nil {
		if t, ok := WrapupTaskTimeoutOverride(agentKey); ok && strings.TrimSpace(t) != "" {
			return t
		}
	}
	return TaskTimeoutWrapupDefault(agentKey)
}

func resolveTaskTimeoutTurns(agentKey string) int {
	if WrapupTaskTimeoutTurnsOverride != nil {
		if v, ok := WrapupTaskTimeoutTurnsOverride(agentKey); ok && v > 0 {
			return v
		}
	}
	return resolveWrapupTurns(agentKey) // defaults to the per-run turn count
}

// wrapupSettlementForTask builds settlement for a worker/planner run that is aware
// of the task deadline. See §5 of the design doc:
//   - clamped=true  → this run is clamped by the task deadline: wrap-up due to Timeout = task
//     is due → task-timeout text; due to MaxTurns = turns ran out first within the clamped
//     window and the task still has a few minutes → fall back to the per-run text.
//   - clamped=false → the task is still early: both reasons use the per-run text (i.e. it
//     degrades to wrapupSettlement).
//
// The harness's PromptByReason picks by the ACTUAL reason at wrap-up time, so nothing is
// mismatched at build time.
func wrapupSettlementForTask(agentKey string, disabledTools []string, clamped bool) *harness.Settlement {
	perRun := resolveWrapup(agentKey)
	st := &harness.Settlement{
		Prompt:        perRun, // fallback (also the value for both reasons when not clamped)
		DisabledTools: disabledTools,
		MaxTurns:      resolveWrapupTurns(agentKey),
	}
	if clamped {
		if tt := resolveTaskTimeoutWrapup(agentKey); tt != "" {
			st.PromptByReason = map[harness.TerminalReason]string{
				harness.ReasonTimeout:  tt,     // task is due
				harness.ReasonMaxTurns: perRun, // turns ran out first, task still has time
			}
			st.MaxTurns = resolveTaskTimeoutTurns(agentKey)
		}
	}
	return st
}
