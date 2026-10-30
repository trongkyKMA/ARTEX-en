# Long side-question conversations and the context budget

Fixed on 2026-09-11. The original implementation treated the character count of the request JSON directly as tokens and inherited the main task's 32K output reservation, so normal side questions were rejected early when there was a lot of HTML, JS or tool results.

## Open-source implementation check

- [Grok CLI side-question context](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L739): extracts snippets from the most recent user and assistant text, with a character budget of about 2000 and at most 400 characters per entry. This path does not maintain a continuous side-question Q&A history.
- [Grok CLI independent request](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/utils/side-question.ts): independent cancellation signal; output limit of 2048 tokens when the model supports it; no tools provided.
- [Grok CLI main-session compaction](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/compaction.ts): estimates tokens, keeps recent content, updates the old summary with new content, and handles truncation across turns.
- [OpenCode session compaction](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/compaction.ts): full-request estimate, output/buffer reservation, recent content plus a rolling summary, summary requests without tools; this implementation defaults to a recent budget of 8000 and a summary output limit of 4096 tokens.
- [OpenCode overflow recovery](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/runner/llm.ts): overflow recovery is attempted only before the assistant has started output, and the recovered call does not enter the same overflow recovery path again.

ARTEX borrows the separate output budget, recent content plus rolling summary, and bounded recovery. It keeps norma v0.3.6's structured messages and tool pairing, does not copy Grok's text excerpts, and does not write OpenCode-style main-session compaction events into the ARTEX main transcript.

## Request budget and execution

- Messages use norma's per-content-block UTF-8 byte estimate with its 4/3 margin; system prompt, tool schemas and message framing overhead are counted on top. The estimate is not an exact model token count.
- Side-question output defaults to at most 8192 tokens and never exceeds the output limit already set in the main configuration. The service environment variable `ARTEX_BTW_MAX_OUTPUT_TOKENS` can set a limit of 256-32768; it does not change the product's default model or the main task's parameters.
- The input budget is the context window minus the output limit and a safety margin; an unknown window uses the platform default of 200K. The safety margin is 5% of the window, at least 128 and at most 8192 tokens.
- Successful Q&A is loaded in batches of at most 20 pairs by increasing ordinal. At most 20 pairs are kept verbatim, with a token budget of at most 1/4 of the input budget and no more than 16K.
- Q&A beyond that is folded into the rolling summary. The summary carries the historical source and context time; a past assistant answer is not equivalent to new tool evidence, and on conflict the latest main snapshot takes precedence.
- When the main context is still too long, only the older messages of the copy are summarized, keeping at most 8K tokens of recent content; the cut point never separates a tool call from its result. An oversized single group goes into the summary as a whole.
- Summary input is split into UTF-8-safe chunks sized to the actual remaining window, with an output limit of 2048 tokens; an empty summary, truncation, tool calls or exceeding the summary budget are never written to the cache. A single side question makes at most 12 summary calls and is subject to the same 120-second timeout; hitting the limit fails explicitly instead of looping forever.
- If the model first reports a context overflow and no text or tool call has been output yet, the request is shrunk further and retried at most once; if the estimated size does not drop, recovery stops immediately. Other model errors and partial streaming output do not trigger this recovery.
- All usage obtained, including summaries, failed attempts and usage at cancellation, is added to the same side-question request. When the Provider returns no usage, only zero can be recorded; an estimate is never passed off as actual usage.

## Persistence and UI

`side_question_sessions.memory` stores the old Q&A summary, the ordinal it covers, and main-context summaries cached by snapshot identity. `side_question_requests.context_info` stores the preparation phase, the number of groups actually replayed, summary usage and the budget estimate.

A summary is saved only while the original request is still running and the clear version matches; clear also wipes the cache, and late writes cannot restore cleared data. A new snapshot does not reuse an old snapshot's summary. The summary fields are saved with v3 task archives; restoring an old v3 archive that lacks the fields fills in empty objects, and v1/v2 remain compatible.

POST first admits and returns the request; preparation and compaction run in the background without holding the admission lock or a database transaction. SSE/history show the preparing, organizing Q&A, compressing copy and answering phases; a compaction failure is saved as that side request's failed terminal state. The frontend keeps the error and restores the failed question as a draft, does not cover the input box with a floating notification, and history polling no longer clears the submit error.

## Validation record

- Replay of 19/20/21/50 pairs, keeping old conclusions across 20 pairs, reuse of the cached summary after restart: automated tests pass.
- Very long Chinese answers and code context, chunked request budget, tool pairing, unchanged snapshot, cache invalidation on a new snapshot: automated tests pass.
- Summary failure/cancel/truncation/oversize/tool return, clear races, call limit, only one overflow recovery and no retry for partial streams: automated tests pass.
- Paging, restart, v1/v2/v3 archives, archive/restore of the summary cache and budget metadata, old v3 missing the new fields, and 20 parent sessions sharing four concurrency slots, on an isolated PostgreSQL: pass.
- Go candidate service build, frontend TypeScript check, Biome check of the changed components, and a Next.js production build in a separate directory: pass.
- The built-in browser, using a separate UI fixture at 1280x720 and 390x844, verified the organizing phase, the summary scope hint, draft restore after failure, no floating error notification, no horizontal overflow and no console errors. The temporary fixture has been removed.
- A read-only replay of existing local Worker snapshots passes the new budget check; for example Worker #3's 293085-character snapshot is no longer wrongly rejected by the local character count. No external model call was made for this item.
- The real-conversation test that would have sent a private Worker snapshot to Grok was rejected by the automatic approval review and was not run; it is not counted as passing.
- 2026-09-11 00:37: restarted the local backend at the user's request, reusing the original database, data directory and login configuration. The running file and the candidate binary have the same SHA-256; `/api/health` on both the backend and the frontend proxy return OK.

Validation commands (isolated test database only):

```sh
go test -race ./sidequestion ./db ./server -run 'TestSide|TestCheckpoint|TestSnapshot|TestBuildRequest|TestService|TestMainSide|TestTaskArchive' -count=1
go build ./cmd/artex
npx tsc --noEmit
npm run build -- --webpack
```

The frontend production build uses a separate copy to avoid overwriting the `.next` of the current preview. The candidate service is at `/private/tmp/artex-btw-budget-candidate`, was copied to `/private/tmp/artex-btw-preview/artex` and started; the original binary is backed up as `artex.before-context-budget` in the same directory.
