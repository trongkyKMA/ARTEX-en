package agent

import (
	"context"
	"errors"
	"fmt"
)

// AbortCause names why an agent run's context was cancelled. Every cancellation
// site should attach one so the activity trace can report the real initiator.
type AbortCause struct {
	Code  string
	Short string
	Text  string
}

func (c *AbortCause) Error() string { return c.Text }

func cause(code, short, text string) *AbortCause {
	return &AbortCause{Code: code, Short: short, Text: text}
}

// Causef builds a cause that includes runtime-specific detail.
func Causef(code, short, format string, args ...any) *AbortCause {
	return &AbortCause{Code: code, Short: short, Text: fmt.Sprintf(format, args...)}
}

var (
	// Task-level execution context.
	AbortPausedByUser = cause("paused_by_user", "User paused the task",
		"The user paused the task via the task control API (POST /api/tasks/{id}/control, action=pause). This Planner/Worker run was cancelled on purpose; running intents return to the frontier (open) and are re-claimed and run from the start after the task resumes")
	AbortPausedByOrchestrator = cause("paused_by_orchestrator", "Orchestrator agent paused the task",
		"The orchestrator agent called the pause_task tool to pause this task. This Planner/Worker run was cancelled on purpose; running intents return to the frontier (open) and run again after resuming")
	AbortTaskDeleted = cause("task_deleted", "Task was deleted",
		"The task is being deleted (DELETE /api/tasks/{id}); the deletion barrier cancelled the task's running Planner, Workers and main agent; results of this run will not be used")
	AbortPausedOnReload = cause("paused_on_reload", "Backend restored the paused state",
		"On startup the backend restored the task's paused state from the database. This run was cancelled; normally no agent is running during recovery")
	AbortGoalMet = cause("goal_met", "Planner judged the task goal met",
		"The planner determined the task goal was met and set the task to done, then cancelled the still-running Workers; these intents are marked stopped, not failed")
	AbortSettleDrainTimeout = cause("settle_drain_timeout", "Task-timeout wrap-up wait ran out",
		"After the task reached its timeout it waited for running Workers to wrap up gracefully, but the 90-second drain grace period was not enough, so a hard cancel was issued; intents are marked exhausted, and facts and assets already written during wrap-up are kept")

	// Per-work context.
	AbortKilledByPlanner = cause("killed_by_planner", "Planner killed this intent",
		"The planner called kill_work to terminate this intent, usually because it went off track or is no longer worth pursuing; the intent is marked stopped and will not be re-claimed automatically")
	AbortWorkPausedByUser = cause("work_paused_by_user", "User paused this Worker intent",
		"The user paused the running Worker. This call was cancelled and the intent became paused; registered intents, facts, findings and activity records are all kept, and it runs again from the start after resuming")
	AbortWorkCancelledByUser = cause("work_cancelled_by_user", "User deleted this Worker intent",
		"The user deleted the running Worker. This call was cancelled; once the Worker leaves its write section, the server handles the intent according to the deletion mode the user chose — soft delete only marks it deleted and keeps all output, hard delete cascades to remove the intent and the downstream nodes supported only by it")
	AbortWorkFinished = cause("work_finished", "Worker finished, context released",
		"The Worker finished normally and the engine released its context resources in detachWork. This is not an interruption; if it appears in an interruption message, cancellation raced with the completion event")
	AbortPausedRaceGuard = cause("paused_race_guard", "New runs refused while paused",
		"While the task is paused the engine refuses to issue new execution contexts, so a race between claim and pause cannot let a Worker keep starting; claimed intents return to the frontier")

	// Main Agent and standalone conversation contexts.
	AbortChatStoppedByUser = cause("chat_stopped_by_user", "User stopped this chat turn",
		"The user clicked stop, ending this main-agent or conversation-agent run. Activity records already produced are kept, and the next message can be sent")
	AbortChatPausedWithTask = cause("chat_paused_with_task", "Task pause stopped the main agent chat",
		"When the user paused the task, the running main agent chat was cancelled as well. Activity records already produced are kept; this turn's message is not replayed automatically after the task resumes")
	AbortChatTurnFinished = cause("chat_turn_finished", "Chat turn finished, context released",
		"This chat turn finished normally and the server is releasing its context resources. This is not an interruption; if it appears in an interruption message, cancellation raced with the completion event")

	// Process-level and per-run hard backstop.
	AbortShutdown = cause("shutdown", "Backend process is shutting down",
		"The backend process received SIGINT or SIGTERM and is restarting, updating or shutting down. All running agents are cancelled; leftover running intents are reset to open and run again after restart")
	AbortRunHardTimeout = cause("run_hard_timeout", "Single-run hard timeout triggered",
		"A single run exceeded its soft wall-clock budget plus extra grace, meaning a model request or a tool did not return for a long time, so the normal turn-boundary wrap-up could not run. Check the last tool call that had not returned before the interruption")
)

// AbortReason resolves the named cause attached to a cancelled run context.
func AbortReason(ctx context.Context) (code, short, text string, ok bool) {
	c := context.Cause(ctx)
	if c == nil {
		return "", "", "", false
	}
	var ac *AbortCause
	if errors.As(c, &ac) {
		return ac.Code, ac.Short, ac.Text, true
	}
	switch {
	case errors.Is(c, context.DeadlineExceeded):
		return "deadline_exceeded", "upstream context reached its deadline",
			"upstream context reached its deadline, but the setter did not attach a named cause via WithTimeoutCause: " + c.Error(), true
	case errors.Is(c, context.Canceled):
		return "canceled_no_cause", "canceller attached no named cause",
			"upstream context was cancelled, but the canceller did not attach a named cause via context.WithCancelCause; register the cause in agent/cancelcause.go and wire it into that cancellation point", true
	default:
		return "other", firstLine(c.Error(), 80), c.Error(), true
	}
}
