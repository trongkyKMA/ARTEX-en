package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/intercept"
	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
	"github.com/Autumn-27/norma/transcript"
)

// Planner is the event-driven LLM planner (docs §4.3): each time the asset or
// exploration graph changes (debounced), it reads the exploration route, queries
// assets, judges whether the task goal is met, and emits 0..N exploration intents
// into the frontier. It is the sole intent generator.
type Planner struct {
	findingRecorder   FindingRecorder
	prov              llm.Provider
	model             string
	tx                *transcript.Store                      // raw LLM conversation persistence (nil = off)
	window            int                                    // context window in tokens (for compaction)
	windowFn          func() int                             // optional dynamic task-chain minimum
	maxTurns          int                                    // max agent turns per run (0 = unlimited)
	killWork          func(intentID int64) error             // engine callback to terminate a running work (nil = off)
	steerWork         func(intentID int64, msg string) error // engine callback to steer a running work mid-run (nil = off)
	proxyAddr         string                                 // recording proxy for WebFetch (empty = direct)
	proxyCACert       string                                 // recording proxy's CA cert path (HTTPS verify)
	webSearch         WebSearchOpts                          // web_search tool backend selection (off by default)
	workDir           string                                 // shared work dir (surfaced in prompt as artifact-output target)
	injectConstraints func() bool                            // resolver: inject task operation constraints into system prompt? (nil = yes)
	nonStreamingFn    func() bool                            // resolver: use non-streaming (Complete) path? (nil = streaming)
	noaEnabledFn      func() bool                            // resolver: use experimental noa compaction? (nil = off)
	maxTokensFn       func() int                             // resolver: per-reply output cap (nil/0 = send no cap)
	compactor         *Compactor                             // cold-node compaction (§7); nil = disabled

	// todos keeps ONE plan-scratchpad per task (keyed by exploration id) so the
	// planner's multi-step plan survives across wake-ups — each Plan() is a fresh
	// session, but the shared store lets it record a serial exploit chain once and
	// dispatch it step-by-step over rounds instead of front-loading it in parallel.
	todoMu sync.Mutex
	todos  map[int64]*actool.TodoStore
}

func NewPlanner(prov llm.Provider, model, workDir string, tx *transcript.Store, window, maxTurns int) *Planner {
	return &Planner{prov: prov, model: model, workDir: workDir, tx: tx, window: window, maxTurns: maxTurns, todos: map[int64]*actool.TodoStore{}}
}

func (p *Planner) SetCompactionWindowResolver(fn func() int) { p.windowFn = fn }

// SetCompactor wires the cold-node compactor (cold-digest §7). Called each
// planner wake-up to advance the round counter, maintain cold stamps, and
// (off the hot path) fold cold nodes into digests. nil = feature disabled.
func (p *Planner) SetCompactor(c *Compactor) { p.compactor = c }

// SetNonStreaming wires a resolver deciding whether runs use the non-streaming
// model path (true = non-streaming). nil/unset = streaming (default).
func (p *Planner) SetNonStreaming(fn func() bool) { p.nonStreamingFn = fn }

func (p *Planner) nonStreaming() bool { return p.nonStreamingFn != nil && p.nonStreamingFn() }

// SetNoaEnabled wires a resolver deciding whether runs use the experimental noa
// context-compression mechanism. nil/unset = off (built-in compaction). Read per
// run so the settings toggle takes effect without rebuilding the agent.
func (p *Planner) SetNoaEnabled(fn func() bool) { p.noaEnabledFn = fn }

// SetMaxTokens wires a resolver for the per-reply output cap. nil/unset or 0 =
// send no cap and let the endpoint decide. Read per run, like nonStreaming.
func (p *Planner) SetMaxTokens(fn func() int) { p.maxTokensFn = fn }

func (p *Planner) maxTokens() int {
	if p.maxTokensFn == nil {
		return 0
	}
	return p.maxTokensFn()
}

func (p *Planner) compactionWindow() int {
	if p.windowFn != nil {
		return p.windowFn()
	}
	return p.window
}

// SetProxy points the planner's WebFetch at the recording proxy plus the CA cert
// it trusts to verify HTTPS through it (empty addr = direct).
func (p *Planner) SetProxy(addr, caCert string) { p.proxyAddr, p.proxyCACert = addr, caCert }

// SetWebSearch selects the web_search backend for the planner (off by default).
func (p *Planner) SetWebSearch(o WebSearchOpts) { p.webSearch = o }

// SetConstraintInject wires a resolver deciding whether this task's operation
// constraints get injected into the planner system prompt. Read per round so the
// settings toggle takes effect without rebuilding the agent. nil = inject (default).
func (p *Planner) SetConstraintInject(fn func() bool) { p.injectConstraints = fn }

// wantConstraints reports whether constraint injection is enabled (default yes).
func (p *Planner) wantConstraints() bool { return p.injectConstraints == nil || p.injectConstraints() }

// todoFor returns the task's persistent planning todo store, creating it on first
// use. Shared across all of this task's planner wake-ups.
func (p *Planner) todoFor(expID int64) *actool.TodoStore {
	p.todoMu.Lock()
	defer p.todoMu.Unlock()
	s := p.todos[expID]
	if s == nil {
		s = actool.NewTodoStore()
		p.todos[expID] = s
	}
	return s
}

// SetKillWork wires the engine's per-work terminate callback so the planner's
// kill_work tool can stop a single running worker.
func (p *Planner) SetKillWork(fn func(intentID int64) error) { p.killWork = fn }

// SetSteerWork wires the engine's per-work steering callback so the planner's
// steer_work tool can inject a mid-run course-correction into a running worker.
func (p *Planner) SetSteerWork(fn func(intentID int64, msg string) error) { p.steerWork = fn }

// renderPlannerTodos formats the persistent planning todo for injection into the
// wake-up prompt (empty when there are no todos yet — first wake-up).
func renderPlannerTodos(items []actool.Todo) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n**Your planning todos (kept across wake-ups; written by you in the previous round)**:\n")
	for _, it := range items {
		mark := map[actool.TodoStatus]string{actool.TodoPending: "☐", actool.TodoInProgress: "▶", actool.TodoCompleted: "✔"}[it.Status]
		if mark == "" {
			mark = "☐"
		}
		b.WriteString(fmt.Sprintf("  %s %s\n", mark, it.Content))
	}
	b.WriteString("Advance from this: dispatch intents only for the next step whose **prerequisite steps are done / the facts it depends on already exist**; update the list with TodoWrite (mark steps already satisfied by facts as completed). Do not re-dispatch steps that are already pending/in_progress in the list.")
	return b.String()
}

// TriggerEvent describes what concretely caused this planning round to fire, so
// the planner looks first at the actual change instead of re-scanning the whole
// overview. Kind:
//
//	"done"    — a worker finished intent IntentID (its output conclusion is fetched).
//	"finding" — a worker reported a finding on intent IntentID (Detail = summary).
//	"goal"    — the human (via the main agent's set_goals) added one OR MORE goals in a
//	            single call (Goals = the goal texts added this time, 1+; set_goals supports batches).
//	"goal_deleted" — the human deleted a goal from the overview's goal management (Detail = deleted goal text).
//	"goal_edited"  — the human edited a goal from the overview's goal management (OldGoal→NewGoal text).
//	"cancelled" — the human deleted intent IntentID (Detail = deletion reason). The intent is
//	            stopped (not deleted) and the reason is attached to it as a fact.
type TriggerEvent struct {
	Kind     string
	IntentID int64
	Detail   string
	Summary  string   // Kind=="cancelled" only: intent summary captured before deletion (after a real delete the node no longer exists and can't be queried)
	Goals    []string // Kind=="goal" only: goal texts added by this set_goals call (one or more)
	OldGoal  string   // Kind=="goal_edited" only: goal text before the edit
	NewGoal  string   // Kind=="goal_edited" only: goal text after the edit
	Hints    []string // Kind=="hint" only: hint texts added by this add_hint call (one or more)
}

// renderTriggers spells out the change(s) that fired this round: for a finished
// worker — which intent + its output conclusion; for a finding — which intent +
// what was found. Empty for time/heartbeat wakes. Reads the store (best-effort;
// a blank field never blocks the round).
func renderTriggers(ts *db.ExplorationStore, evs []TriggerEvent) string {
	if len(evs) == 0 || ts == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n**The actual changes that triggered this round (look here first, then decide whether to add directions)**:")
	for _, ev := range evs {
		switch ev.Kind {
		case "goal":
			if len(ev.Goals) == 1 {
				b.WriteString(fmt.Sprintf("\n- The human (main agent) added a goal: %s — a new goal to achieve; add exploration directions for it (if no intent covers it yet).", ev.Goals[0]))
			} else {
				b.WriteString(fmt.Sprintf("\n- The human (main agent) added %d goals: %s — all are new goals to achieve; add exploration directions one by one for each goal that has no corresponding intent yet.", len(ev.Goals), strings.Join(ev.Goals, "; ")))
			}
		case "hint":
			if len(ev.Hints) == 1 {
				b.WriteString(fmt.Sprintf("\n- The human (main agent) added a strategic hint: %s — it is attached to the exploration graph; adjust/add exploration directions accordingly (if no intent covers it yet).", ev.Hints[0]))
			} else {
				b.WriteString(fmt.Sprintf("\n- The human (main agent) added %d strategic hints: %s — all are attached to the exploration graph; adjust/add exploration directions according to each one.", len(ev.Hints), strings.Join(ev.Hints, "; ")))
			}
		case "goal_deleted":
			b.WriteString(fmt.Sprintf("\n- The human deleted this goal: %s — the goal has been removed; re-judge the remaining goals/directions accordingly (no need to dispatch intents for it any more).", ev.Detail))
		case "goal_edited":
			b.WriteString(fmt.Sprintf("\n- The human edited a goal, from \"%s\" to \"%s\" — adjust exploration directions to the new goal (stop dispatching the old directions if they no longer apply).", ev.OldGoal, ev.NewGoal))
		case "finding":
			b.WriteString(fmt.Sprintf("\n- The worker of intent #%d (%s) reported a finding: %s", ev.IntentID, intentSummary(ts, ev.IntentID), ev.Detail))
		case "cancelled":
			// Prefer the Summary captured at deletion time for the intent content (after a real delete the node is gone and intentSummary finds nothing).
			sm := ev.Summary
			if sm == "" {
				sm = intentSummary(ts, ev.IntentID)
			}
			b.WriteString(fmt.Sprintf("\n- Intent #%d was deleted by the user; the intent content was: %s, the deletion reason was: %s. The intent has been deleted (it will not run any more); re-plan accordingly.", ev.IntentID, sm, ev.Detail))
		default: // "done"
			b.WriteString(fmt.Sprintf("\n- The worker of intent #%d (%s) finished, output conclusion: %s", ev.IntentID, intentSummary(ts, ev.IntentID), workerOutput(ts, ev.IntentID)))
			if fids := factIDsYielded(ts, ev.IntentID); fids != "" {
				b.WriteString(fmt.Sprintf("; fact ids newly produced by this intent: %s ", fids))
			}
		}
	}
	b.WriteString("\n(For full details, query again with node_detail / get_worker_output / list_findings.)")
	return b.String()
}

// factIDsYielded lists the fact ids an intent produced this run as "#12, #15", so the
// planner can jump straight to the round's incremental facts. Empty (best-effort) when
// the intent yielded no facts or the lookup fails.
func factIDsYielded(ts *db.ExplorationStore, id int64) string {
	ids, err := ts.FactsYielded(id)
	if err != nil || len(ids) == 0 {
		return ""
	}
	parts := make([]string, len(ids))
	for i, fid := range ids {
		parts[i] = fmt.Sprintf("#%d", fid)
	}
	return strings.Join(parts, ", ")
}

// intentSummary reads an intent node's one-line summary (best-effort, "?" on miss).
func intentSummary(ts *db.ExplorationStore, id int64) string {
	n, err := ts.GetNode(id)
	if err != nil || n == nil {
		return "?"
	}
	var p map[string]any
	if json.Unmarshal(n.Payload, &p) == nil {
		if s, ok := p["summary"].(string); ok && s != "" {
			return s
		}
	}
	return "?"
}

// workerOutput returns the finished worker's conclusion for an intent — the last
// 'result' (else 'text') activity's full detail, truncated. Same source get_worker_output uses.
func workerOutput(ts *db.ExplorationStore, id int64) string {
	acts, _, err := ts.ActivityList(&id, 0, 1000)
	if err != nil {
		return "(failed to fetch output)"
	}
	var pick *db.Activity
	for i := range acts {
		if acts[i].Kind == "result" {
			pick = &acts[i]
		} else if acts[i].Kind == "text" && pick == nil {
			pick = &acts[i]
		}
	}
	if pick == nil {
		return "(this work has no output record yet)"
	}
	out, _ := ts.ActivityDetail(pick.ID)
	if out == "" {
		out = pick.Summary
	}
	return truncOutput(out, 800)
}

// truncOutput caps a worker-output blob so the trigger context doesn't bloat the
// system prompt every round; full text is one get_worker_output call away.
func truncOutput(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + " … (truncated; see get_worker_output for the full text)"
}

// renderGraphOverview folds the pre-computed graph_overview snapshot into the
// wake-up prompt so the planner starts each round with the full situation in
// hand — saving the round-trip it would otherwise spend calling the tool. It is
// the exact same JSON graph_overview would return; deeper detail is still one
// tool call away (node_detail / list_facts / …).
func renderGraphOverview(data map[string]any) string {
	b, err := json.Marshal(data)
	if err != nil {
		return "" // fall back to the model calling graph_overview itself
	}
	return "\n\n**This round's situation (prefetched graph_overview, identical to what calling that tool returns; call node_detail/list_facts etc. on demand for details)**:\n" + string(b)
}

// plannerDefaultTmpl is the built-in EDITABLE body (segment [A]) of the planner prompt,
// seeded into agent_prompts. Goal is a {{.Goal}} template var; the intermediate-artifact
// output-rules tail is code-owned (artifactSpec) and appended by plannerSystem after rendering.
const plannerDefaultTmpl = `You are the "planner" of an authorized penetration-testing system on a cybersecurity platform, and you are woken up frequently (every time the graph changes). Your job: read the situation → judge the goals → add exploration intents **only when there really is a new, uncovered direction**. You are the planner, not the executor: everything you produce this round can only be **generating/clarifying intents** or **judging goals** — never do the work yourself inside plan.

Task goal: {{.Goal}}

**How many intents this round should produce (think this through first)**:
- **Hard floor (highest priority)**: as long as **the goal is not met** and **there is currently no open or running intent** (frontier_open=0 and running_intents is empty), this round **must** produce at least one intent that advances toward the goal — when there is no running work to wait for and no queued direction, producing 0 intents = the task stalls; even if all known directions are only in recent_done, open a new one or continue one based on the done/exhausted/blocked judgment below.
- Beyond the hard floor, **producing 0 intents is a normal outcome, but it needs a legitimate reason** (not a "fewer is safer" default): ① **already covered** — every direction you thought of is already being handled by an intent that is still open/running (regenerating an existing intent with different wording is a serious error); ② **waiting on a dependency** — the next step depends on the output of currently running work that has not come out yet (forcing it now leaves downstream without its prerequisite and spinning idle; wait until the graph is updated on the next wake-up and dispatch then).
- Conversely: if there really is a new direction that is **uncovered and does not depend on running work**, or the goal is not met and untested surface remains in scope, dispatch it — don't use 0 intents as a lazy default.

**Decision flow on each wake-up**:

1. **The full situation is attached below this prompt** (it is exactly graph_overview's return; no need to call it again): task (original title + goal/root node), asset counts, goals + status, open/running/recent_done intents, sites_without_endpoints (sites with no endpoints, hinting at directions that may still need exploring), facts (number of exploration facts; a different category from vulnerabilities), recent_facts ({id,summary,confidence?}).
   - **Scope**: exploration nodes (goals/intents/facts/findings) contain only this task; **the asset graph is globally shared** (one copy across tasks; asset counts are global in-scope counts, not exclusive to this task) — ignore assets unrelated to this task when they appear.
   - **Lineage**: every intent carries parents (upstream: which facts/intents it derives from) and yields (downstream: which facts/findings it produced), and every recent_facts entry carries from_intent; use these to understand "which facts come from which direction, and whether they can be combined into a new direction".
   - **Negative/doubtful observations** ("port closed/not injectable" etc. in recent_facts) are a worker's observations, not verdicts: before accepting one, look at its evidence with node_detail(id) — only when the evidence is solid, confidence=observed and the techniques were exhausted, treat that direction as closed for now; when the evidence is missing, it is only "looks like / probed once", or confidence=inferred, treat it as **not yet established** — if it is in scope and no other intent covers it, by default dispatch one re-check intent to confirm or refute it (**re-check the same negative direction at most once**; if it is still negative after the re-check and the evidence is reasonable, respect that conclusion and don't dispatch again).
   - **Call for deeper detail only when needed**: list_facts (paged, newest first, default 20, filter with q, page with before, carries total/has_more), list_findings (all vulnerabilities), node_detail(id) (full evidence/details; lists/recent_facts only give summaries), list_assets (pull: q search, type/company_id/task_id filters, paging, or fetch directly by id/ids), asset_neighbors. Assets are globally shared — don't pull everything by default.

2. **Judge goals (core duty)**: the goals field already contains the goals and their status; for an unmet goal that some finding/fact has proven, call prove_goal(goal_id, evidence_id, reason) to mark it met. **When the goal you mark is exactly the last unfinished goal, the system automatically judges the whole task complete** — wrap-up is driven only by prove_goal, one goal at a time; there is no other "one-click complete" mechanism.
   - ⚠️ **Quantitative acceptance check (stamping it early is strictly forbidden)**: when a goal contains a quantifiable condition (coverage reaches X%, capture N flags, obtain some privilege), before prove_goal you **must** check the measured values in graph_overview above (coverage.pct, the findings_total count, etc.): if it is not met, prove_goal is **forbidden** — dispatch intents to close the gap instead; do not mark it met early on the grounds of "mostly achieved / the core is already taken". Example: the requirement is 100% coverage and the measured coverage.pct=40% → not met, keep dispatching intents to fill in the testing.

3. **(Optional, only at the start, extremely light) Probe to understand**: only when the graph has almost no facts yet (recent_facts basically empty, task just started) and the situation alone is not enough to make the initial intents concrete, use Bash etc. to do a very small amount of read-only probing of the target (e.g. 1–2 curls to look at the homepage/fingerprint). **The only legitimate output is a more precise intent description** — never discovering/verifying/exploiting a vulnerability, and never enumeration results of endpoints/directories/parameters (those are the worker's job; write them as intents and dispatch them). Three hard boundaries:
   - The graph already has worker-produced facts (facts>0 / recent_facts non-empty) → probing yourself again is **forbidden**; base every judgment on the existing facts, and this round's output can only be "dispatch new intents" or "end"; want to dig into a lead → dispatch an intent for a worker to investigate it, don't curl it yourself.
   - Even at the start, probe at most ≤3 times and then stop, only to make the initial intents clear; as soon as you notice you are "verifying in depth" rather than "quickly setting a direction" (enumerating endpoints/directories one by one, trying ids one by one, decoding chains, repeatedly probing the same endpoint, any testing/verification of injection/privilege escalation/vulnerabilities — all heavy worker work), stop immediately and write it as an intent.
   - Whatever can be judged from the existing facts/situation needs no probing at all.

4. **Decide which new directions to add**: **"Restraint" here only means "not duplicating existing intents", not "dispatch as few as possible"** — when the goal is not met, the default question is "to get closer to the goal, what deeper, harder-hitting, not-yet-covered approaches remain", not "can we wrap up". An intent is an **open exploration direction** (not a fixed type/menu); judge directions yourself from the known facts, assets and goals, and compare each one against open + running + recent_done:
   - Already covered by open/running → don't generate it (it is being handled).
   - Appeared in recent_done → **first look at that intent's state (every entry carries it) to tell how it stopped, then decide**:
     · **done (ran to completion normally)**: covered → don't re-dispatch it as is; whether it is a dead end depends on the conclusions of the facts it yields, not on state; re-dispatch only when a **material new mechanism** appears (new facts/assets/parameters/a clearly different approach), and state in summary how it differs from last time; rewording or "maybe it works if we try again" doesn't count — retrying is forbidden.
     · **exhausted (budget ran out, cut off halfway, only partial write-back) / blocked (model or network failure, barely explored)**: both stopped midway without a clean finish and with incomplete information — first use get_worker_trace / get_worker_output to see how far it actually got and where it got stuck, then choose from the following: close to a breakthrough but cut off by the budget → dispatch "continue from the last progress"; did not run because of a purely external fault (often the case for blocked) → re-dispatch the same direction directly; stuck at the same place every time → change approach/direction. The basis is always the real progress in the trace, not the state itself.
   - A brand-new direction that no intent covers at all → generate it.
   - All known directions are covered by intents that are still open/running → don't generate, end directly (there is running/queued work; wait for it to advance); but if only recent_done covers them, nothing is open/running any more and the goal is not met → per the hard floor at the top you must open a new one or continue one.
   - **Depth over coverage**: coverage is a floor/acceptance item, not the exploration goal itself; after finding a high-value entry point (one that may lead to RCE/privilege escalation/data exfiltration), prioritize dispatching intents to **drive that path all the way through**, rather than spreading wide and shallow-testing asset by asset to even out coverage.
   - **Keep routes diverse, don't converge too early**: when the goal is not met, if the existing intents all crowd onto the same route/entry point while there is an **essentially different** uncovered direction (another entry surface/another class of asset/another exploit chain), prioritize adding that divergent direction rather than adding synonymous intents on the same line (judge by substantive difference, not wording); if that divergent direction is already covered by existing intents, still don't generate it. Ideally 2–3 routes with different mechanisms coexist (e.g. "attack via the upload chain" and "attack via authentication bypass"), and resources are concentrated on one only after it delivers evidence of **approaching the goal**. **But diversity always yields to the "operation constraints" at the top**: entry surfaces/ports/hosts/operations excluded by the constraints never get an intent, even if they are essentially different.

   **Serial exploit chains: dispatch step by step, don't split them into parallel.** For a strongly dependent serial chain (①→②→③, where each later step depends on the actual output of the previous one): don't dispatch it all at once in parallel (downstream can't get a prerequisite that doesn't exist yet and will only duplicate work/spin idle); use TodoWrite to record the whole chain as todos (one per step), dispatch this round only the step whose "prerequisites are satisfied" (usually the first), and after it produces a fact, on the next wake-up (the prompt will carry the todo list) dispatch the next step and mark the satisfied ones completed. Don't split "the same thing" into two ("confirm the trigger point" and "trigger the trigger point" are the same step); use multiple parallel intents only for **parallel, mutually independent** dimensions (e.g. enumerating several unrelated endpoints).

5. **Submit**: submit the selected new directions with **one** batched add_intent call (intents array, at most the 4 highest-value ones; don't call it repeatedly one by one):
   - **summary**: one natural-language sentence describing the direction (full address of the test target + what to do + why), without forcing it into a fixed category; deduplication relies mainly on comparing it with existing intents.
   - **asset_ids**: ids of the target assets this direction will test/attack (pass them whenever possible, 0/1/many, from list_assets) — whenever the direction revolves around concrete assets (site/endpoint/parameter/host) be sure to pass them; they are used for coverage dedup and for linking into the asset chain; if it spans several assets pass all of them; leave it empty only for purely global recon with no concrete asset.
   - **parent_ids**: which upstream nodes this direction is synthesized from (optional, 0/1/many) — when several facts combine into one intent pass all of them; also pass the id of an upstream intent/finding it derives from; leave it empty for a brand-new top-level direction.

No duplication, no forcing it; but when the goal is not met and there is an uncovered, deeper approach, dispatch it. Be concise, focused and efficient.`

func plannerSystem(goal, dataDir, workDir string) string {
	body := renderSystem("planner", plannerDefaultTmpl, PlannerVars{Goal: goal, DataDir: dataDir, Now: nowStr()})
	return body + artifactSpec(workDir)
}

// Plan runs one planning round. emit, if non-nil, receives the planner's execution
// steps (so users can see how it reads the situation and judges goals — the
// planner is the intent generator and was previously a black box). Returns whether
// the planner judged the goal met.
// triggers carries the concrete change(s) that fired this round — worker(s) done
// and/or finding(s) reported (may be several — the engine debounces a burst; empty
// for time/heartbeat wakes). They are spelled out at the top of the prompt so the
// planner looks first at the actual change (which intent, its output/finding).
func (p *Planner) Plan(ctx context.Context, taskID int64, as *db.AssetStore, ts *db.ExplorationStore, goal string, triggers []TriggerEvent, emit func(db.Activity)) (met bool, reason string, err error) {
	// cold-digest §2.3/§7: advance this task's planner-round counter, maintain the
	// cold_since_round stamps, and (if a threshold is hit) kick off background
	// compaction. Synchronous part is cheap (a few queries); the LLM compaction
	// runs in a detached goroutine so it never adds latency to this round.
	p.compactor.OnPlannerRound(ctx, ts)
	tsx := NewToolSet(ts, "planner")
	tsx.SetFindingRecorder(p.findingRecorder)
	if as != nil {
		tsx.SetAssetStore(as, as.Companies())
	}
	tsx.SetTaskID(taskID)
	tsx.SetCoverageEnabled(as == nil || as.CoverageEnabled(taskID))
	tsx.killWork = p.killWork   // enable kill_work tool (nil = unavailable)
	tsx.steerWork = p.steerWork // enable steer_work tool (nil = unavailable)
	if origin, _ := ts.OriginFactID(); origin > 0 {
		tsx.SetOwnerNode(origin) // planner-side anchors default to the task root (origin fact)
	}
	// Domain tools + the base default tool set (Read/Write/Edit/MultiEdit/LS/Glob/Grep/Bash).
	// When asset coverage is off, drop add_task_scope/list_untested_assets (kept out of the prompt).
	base := append(tsx.DropCoverageTools(tsx.PlannerTools()), actool.DefaultTools()...)
	ctx = WithRunInfo(ctx, RunInfo{TaskID: taskID, ExplorationID: explorationID(ts)})
	tools, def, cleanup := AugmentTools(ctx, "planner", base)
	defer cleanup()
	// The key situation (just-finished intents + the prefetched full graph) now goes into
	// THIS ROUND'S user input (see input below); system keeps only the static planning body.
	// Moving it out keeps system stable across rounds and cache-friendly; the cost is that if
	// a single round grows long the situation may get compacted (planner rounds are usually
	// short, low risk). situational is concatenated into input below.
	situational := renderTriggers(ts, triggers) + renderGraphOverview(tsx.graphOverviewData())
	// Task-level deadline / final mode (injected via ctx, see taskclock.go). On the final round
	// the planner's task-timeout wrap-up text is appended to this round's user input (with
	// situational) as THIS ROUND'S operating instruction, so it only does a last goal check
	// and produces no new intents.
	tc := taskClockFrom(ctx)
	if tc.Final {
		situational += "\n\n**Final task wrap-up (special instruction for this round; overrides the regular planning flow above)**: " + resolveTaskTimeoutWrapup("planner")
	}
	// This task's working directory <workDir>/tasks/<taskID>, created up front.
	taskDir := ensureRunDir(p.workDir, taskID, 0)
	ctx = intercept.WithReviewContext(ctx, taskDir, intercept.ReviewBackground{})
	sysBody := plannerSystem(goal, p.workDir, taskDir)
	if p.wantConstraints() {
		sysBody += constraintBlock(ts) // inject operation constraints (if any) into the system prompt to bound exploration
	}
	system, boundary := deferredSystem(sysBody, def)
	// The planner has no wall-clock budget of its own; with a deadline, clamp MaxDuration to
	// the time left so a running planning round wraps up when the task hits its deadline
	// (timeout → task-timeout text, turns → per-run text).
	maxDur, clamped := clampMaxDuration(tc.DeadlineUnix, 0)
	settle := wrapupSettlement("planner", nil)
	if tc.DeadlineUnix > 0 {
		settle = wrapupSettlementForTask("planner", nil, clamped)
	}
	opts := agentcore.Options{
		Provider:        p.prov,
		SystemPrompt:    system,
		DynamicBoundary: boundary,
		Tools:           tools,
		DeferredTools:   def.Deferred,
		UnlockSet:       def.Unlock,
		PermissionMode:  permission.ModeBypass,
		EnableWebFetch:  true, // goes through the recording proxy for a trail; loads the proxy CA to verify MITM re-signed HTTPS certs
		WebFetchProxy:   p.proxyAddr,
		WebFetchCACert:  p.proxyCACert,
		// Web search (optional). ddgs needs no key; brave-free needs BraveKey; tavily needs TavilyKey.
		// WebSearchProxy is a separate egress proxy (http/https/socks5), unrelated to the traffic-recording MITM proxy; empty = direct.
		EnableWebSearch:       p.webSearch.Enabled,
		WebSearchBackend:      p.webSearch.Backend,
		BraveSearchAPIKey:     p.webSearch.BraveKey,
		TavilySearchAPIKey:    p.webSearch.TavilyKey,
		DeepSeekSearchBaseURL: p.webSearch.DeepSeekBaseURL,
		DeepSeekSearchAPIKey:  p.webSearch.DeepSeekAPIKey,
		DeepSeekSearchModel:   p.webSearch.DeepSeekModel,
		WebSearchProxy:        p.webSearch.Proxy,
		BashEnv:               proxyEnv(p.proxyAddr, p.proxyCACert), // Bash subcommands go through the proxy and trust the CA by default
		WorkingDir:            taskDir,                              // this task's working directory <workDir>/tasks/<taskID>
		ToolOutputDir:         cmdOutDir(taskDir),
		MaxTurns:              p.maxTurns, // 0 = unlimited (configurable in agent management)
		MaxDuration:           maxDur,     // 0 = unlimited; with a deadline = time left until the deadline
		Compaction:            compactionConfig(p.compactionWindow()),
		// Planning todos shared across wake-ups: keeps serial chains across rounds (the session is new, the store is not).
		Todos: p.todoFor(ts.ID()),
		// Hitting THIS ROUND'S turn budget → the SDK runs wrap-up: land the conclusions already
		// worked out this round (add_intent for what should be dispatched, prove_goal for what
		// can be proven, TodoWrite for serial chains) instead of stopping planning — the planner
		// is woken up again and again afterwards. When clamped (by the task deadline) it uses
		// PromptByReason instead (see wrapupSettlementForTask).
		Settlement:   settle,
		NonStreaming: p.nonStreaming(), // use Provider.Complete when this profile picks non-streaming
		MaxTokens:    p.maxTokens(),    // 0 = send no cap, the server default decides
	}
	if p.tx != nil { // persist raw LLM conversation; one accumulating file per task's planner
		opts.Transcript = p.tx
		opts.SessionID = fmt.Sprintf("exp%d-planner", ts.ID())
	}
	// Experimental: when on, noa takes over context compression (archives live persistently under <workDir>/noa/<SessionID>).
	noaSession := fmt.Sprintf("exp%d-planner", ts.ID())
	enableNoa(&opts, p.noaEnabledFn, p.workDir, noaSession, noaWarn(noaSession))
	// The situation (just-finished intents + full graph) now goes into this round's user input
	// (see input below). The user message also carries the instruction + cross-wake-up todos
	// (todos are the model's own regenerable planning notes, fine in user).
	// The opening line has two forms depending on whether this round has a concrete change:
	// change → point at the "actual changes" block below; no change (heartbeat patrol / hint /
	// resume etc.) → don't falsely claim "the graph changed"; instead prompt a re-check of running intents.
	lead := "There was just a concrete change (see \"The actual changes that triggered this round\" below); plan the next step accordingly:"
	if len(triggers) == 0 {
		lead = "This wake-up is a **scheduled patrol (heartbeat due) / no concrete change signal** — the graph has not necessarily changed. Along the way, re-check the running intents: use steer_work to correct ones that have made no progress for a long time or drifted off course, and kill_work to cut losses on ones whose direction is entirely wrong; then judge the goals and decide whether to add directions:"
		// On a heartbeat/no-change wake-up, if the whole graph has no open or running intent left →
		// exploration has stalled (no worker running, no queued direction). Tell the planner so
		// explicitly and force it to add new directions this round, instead of only re-checking
		// running intents and idling for a round.
		if active, err := ts.HasActiveIntent(); err == nil && !active {
			lead = "This wake-up is a **scheduled patrol (heartbeat due)**, and there is currently **no open or running intent at all** — no worker is running and no direction is queued; exploration has stalled. You **must** produce one or more new intents this round that advance toward the goal and are **not duplicates** of any existing intent in the graph (producing 0 intents is not allowed); first judge from the situation below whether the goal is already met, and if not, add directions immediately:"
		}
	}
	input := lead + situational + "\n\nBased on the situation above, judge the goals. When a goal is **truly met** (the goal outcome has been obtained / the goal vulnerability has been confirmed), mark it with prove_goal one by one. **Hard floor: as long as the goal is not yet met and there is currently no open or running intent (frontier_open=0 and running_intents is empty), this round must produce at least one intent that advances toward the goal — there is no running work to wait for and no queued direction, so producing 0 intents = the task stalls. Only when open/running intents are already advancing, or the goal is met, may this round produce no new intents.**" +
		renderPlannerTodos(opts.Todos.List())
	// MaxDuration now interrupts running tools when the wall clock is up and enters wrap-up in
	// place (on the live ctx), so a stuck round no longer bypasses wrap-up and needs no external
	// hard-ctx backstop. ctx only carries pause / kill / shutdown.
	_, _, err = captureRun(ctx, opts, input,
		func(r db.Activity) {
			if emit != nil {
				r.Worker = "planner" // planner activity has no intent_id (it generates them)
				emit(r)
			}
		})
	return tsx.GoalMet, tsx.Reason, err
}
