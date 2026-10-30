# Changelog

Notable changes to this project are recorded in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.3.15] - 2026-10-07

### Intercept

#### Added

- **New built-in intercept rule "delete-style endpoint paths"**: the built-in HTTP destructive rule used to recognise only the DELETE **method**, but most applications' delete endpoints can be triggered with GET/POST, and a call like `curl 'http://t/api/user/delete?id=1'` really deletes target data. A `deny` rule now covers `/delete /del /remove /unlink /erase /destroy` (the verb must be followed by a separator, so `/delivery`, `/details` and `/delta` are not blocked by mistake). Existing instances get it after upgrading; it can be disabled or deleted under "System → Command interception".
- **Token usage of model fallback approval can be viewed separately**: approval calls previously had no metering of their own, so their cost could only be guessed. They are now metered separately, and a usage card appears below the "Model fallback approval" switch under "System → Command interception": cumulative stats for call count, input, output, cache read and cache write, plus a mini bar chart of daily usage over the last 30 days.

### Finding notifications

#### Added

- **Findings can be pushed to IM**: a new "System → Notifications" page pushes scan findings to six channel types: **DingTalk, Feishu, WeCom, generic Webhook, Telegram and email**. Any number of instances can be configured per type, each with its own enable switch, rate limit and filter rules.
- **Two delivery modes, real-time and digest**: real-time mode sends each finding as soon as it matches; digest mode merges them into one message per global period (default 30 minutes), starting with the number of new findings and the severity distribution. For "high severity in real time, the rest in a digest", create two channels and configure them separately.
- **Filter rules in four dimensions**: minimum severity, limiting to task / asset scope, include and exclude keywords on the finding type (exclude wins), and whether to receive disposition status changes (off by default). Messages carry a "View details" button whose target comes from the global "Link-back URL" setting; leave it empty to omit the button.
- **Delivery history and manual resend**: lists each delivery's status, attempt count, failure reason and channel, filterable by channel and status; failed items can be resent in one click (resending resets the retry counter).
- **Masked echo of channel credentials**: webhook URLs, signing secrets, bot tokens, SMTP passwords and the like are only echoed back as masked values with a hint of the last characters; submitting the value unchanged means "do not modify", and clearing the input deletes the field.

#### Fixed

> This section is the outcome of a security audit after the first version of the feature was done; each item was reproduced first, then fixed, then covered by a regression test.

- **Fixed masking bypass via "change the target URL, keep the credentials" (critical)**: config merging kept the stored value for every "key not mentioned", so changing only the URL while saying nothing about the credentials made the server send the real stored credentials to an arbitrary address, completely silently. Now, once the target URL changes, every credential field must be stated explicitly: either a new value, or explicitly empty to say it is no longer needed.
- **Fixed zero escaping of untrusted content in markdown-based channels**: finding titles and summaries come from model output and asset URLs come from scan results, so a crafted title rendered as a clickable external link in DingTalk / WeCom / Feishu, and image syntax was fetched by the client while rendering, leaking the reader's IP. Content is now uniformly collapsed to a single line + markdown metacharacters are escaped, and the escaping happens at each channel's render output rather than in the shared title function.
- **Fixed the SSRF surface of delivery URLs**: loopback, internal and cloud metadata addresses could all be delivered to, and the first 200 bytes of a failed response body went into `last_error` and were echoed by the delivery history, forming a semi-blind read primitive. The guard now sits at the **dial stage**, covers DNS rebinding, and rejects cross-host redirects; loopback and link-local addresses require explicitly setting `ARTEX_NOTIFY_ALLOW_LOCAL=1`, while RFC1918 private networks are still allowed (self-hosted SMTP relays on the internal network are common).
- **Fixed push credentials leaking through error messages**: DingTalk's `access_token`, WeCom's `key` and the Telegram bot token all live in the URL, and on a delivery failure the full URL flowed into four places: `last_error`, delivery history, server logs and frontend toasts. It is now uniformly redacted, keeping only `scheme://host` and the underlying cause.
- **Fixed silent loss when a truncated digest message marked the whole batch as delivered**: truncated findings were neither in the message nor in the failure list, yet the delivery history showed success. Packing is now done by **whole entries**, only those that fit into this message are marked, the rest go back to the queue for the next message without consuming retries, and the message header states how many will continue in the next message.
- **Fixed a typo in the minimum severity threshold silently disabling the filter**: with a typo like `hgih` in `min_severity`, the unknown level's ordinal was 0 and the check degenerated into always-true; users believed they only received high severity while actually every finding was dumped into the group. The value is now validated on the write path, listing the allowed values.
- **Fixed `rate_per_min = 0` (no rate limit) being unreachable**: the DB write layer silently replaced an explicit 0 with the default, so operators believed they had lifted the limit while it was still in effect. The default is now filled in at the API layer when the field is missing.
- **Fixed digest channels bypassing the token bucket entirely**: `rate_per_min` previously had no effect at all in digest mode. The number of items claimed is now bounded by both this round's quota and an in-memory upper limit.
- **Fixed failure handling judging by the batch's maximum attempt count, dragging new deliveries down with old ones**: an old delivery already retried twice pulled brand-new deliveries in the same batch into failed, so new findings were lost permanently without a single retry. This is now decided per item.
- **Fixed deliveries whose snapshot could not be parsed being silently marked successful in a digest batch**: such entries were skipped at render time yet counted as successful along with the whole batch. They are now explicitly failed with a reason.
- **Fixed the per-channel number of deliveries per round possibly exceeding the lease duration**: in multi-instance deployments, rows whose lease expired were claimed again, sent twice and had their attempt count incremented twice. The per-round cap is now derived from "lease / per-attempt timeout", with an assertion pinning the relationship between these constants.
- **Fixed Telegram truncation possibly cutting an HTML entity**: truncation only avoided half-cut tags, not entity fragments like `&amp`, and the parser may then reject the **whole** message. Both are now avoided.
- **Fixed the email channel treating transient SMTP failures as permanent**: 4xx replies such as greylisting `450` are temporary rejections that should be retried later, but were all treated as fatal, so a server with greylisting made every push fail after the first attempt. The first digit of the reply code now decides: 4xx is retryable, 5xx is a permanent failure.
- **Fixed submitting nested structures actually writing the mask literal to the database**: object fields like `webhook.headers` can only be masked or submitted as a whole; putting the mask sentinel inside the object stored it as a real value and silently broke authentication. Such submissions are now explicitly rejected.

#### Design notes

- **The transaction that writes a finding does only one blind INSERT**: `notification_events` is written in the same transaction as the finding, so commit guarantees both are atomically consistent. This INSERT deliberately does not read the channel table or run user filter rules, and is wrapped in a `SAVEPOINT`; otherwise one misconfigured filter condition could abort the transaction and keep a high-severity finding out of the database.
- **Deliveries are claimed with a lease instead of a long transaction**: after claiming with `FOR UPDATE SKIP LOCKED`, the row is set to `sending` and `next_attempt_at` is pushed into the future as the lease, so no database lock is held during delivery; rows left behind by a crashed process are claimed again once the lease expires, self-healing without infinite retries.
- **Rate limiting does not consume the retry budget**: this round's quota is computed from the token bucket first, and then that many items are claimed. The reverse order would count an attempt for deliveries held back by the rate limit, and the three-attempt budget would be used up by pure waiting and end in failure.

### Test infrastructure

#### Fixed

- **Fixed assets permanently left behind by the cleanup order of the company ICP ownership test**: `defer d.Close()` ran first on function return and `t.Cleanup` after it, so all cleanup statements ran on a closed connection, the errors were discarded, test assets and companies stayed in the database forever, and other tests asserting on asset counts failed mysteriously. Closing the connection now also goes through `t.Cleanup` and is registered first, and cleanup failures are surfaced.

### Traffic

#### Added

- **Traffic list supports content search, path / status code / length filters and column sorting**: the filter row can filter by **response content** (via the full-text index), **path**, **status code** (an exact value or a bucket like `2xx`) and **response length range**; the table header can sort by time, status code and response length, and the sort preference is stored locally. Two new indexes take effect automatically on existing instances after upgrading; the query contract of the agent tools is unchanged.
- **New "Clear all" in the traffic list**: deletes all traffic records at once (ignoring the current filter), cleans up historical host directories the index no longer records, then runs a full compaction and reports how much space was actually freed. Traffic evidence bound to findings lives in a separate evidence store and is not affected.

#### Fixed

- **Fixed disk space not being freed after deleting traffic**: the index database was created without `auto_vacuum`, so the file never shrank; the full-text index is also `contentless_delete`, where `DELETE` only writes a tombstone without reclaiming the original postings, so deleting traffic actually made the index grow (measured: 6MB of captured bodies → 16MB index, still 16MB after deleting everything). Newly created index databases now enable `auto_vacuum=incremental`, and after each delete a background job merges the full-text index and reclaims incrementally in chunks, gradually returning space to the system (the same scenario drops back to 104KB); the reclaim releases the write lock between chunks and does not block traffic recording.

> Upgrade note: `auto_vacuum` can only be set when the database is created, so **index databases of existing instances stay in the old mode**, and incremental reclaim is a no-op on them (a one-line notice is printed at startup). After upgrading, tombstone growth on such databases has stopped, and the space already used can be reclaimed once with "Clear all"; that step converts the database to incremental-reclaim mode, after which everyday deletes take effect on their own.

### LLM

#### Fixed

- **Fixed custom session headers not applying on the "one-shot LLM call" path**: goal decomposition (round 0) and cold-node compaction are both one-shot calls without a transcript store, so there was no session id on the context and the gateway could not read the header; for endpoints like opencode zen that return 400 when the header is missing, this showed up as "round 0 fails, while later planner rounds work perfectly". Both paths now explicitly attach a session id that is stable per exploration, which also lets token usage be attributed to the right exploration (previously it was not recorded at all).

### Tools

#### Fixed

- **Fixed output truncation not applying to MCP and custom tools, so large results flooded the context**: MCP tool results were not truncated at all, and HTTP custom tools received an empty tool context and therefore always used a hard-coded 6000 characters instead of the session's configured limit. Both paths now go through `actool.Capture`: truncated at the session's `MaxOutputChars` (default 30000), and when `ToolOutputDir` is configured the full output is spilled to disk, leaving only a leading excerpt and a file pointer in the message.
- **Upgraded norma to v0.4.3**: the harness layer runs `CaptureOnce` uniformly, so no tool (including ones added later) can flood the context again by missing truncation.

### Deployment

#### Fixed

- **Fixed the activity feed failing to connect behind a reverse proxy**: the SSE URL was unconditionally built as `${hostname}:8787`, so in deployments reverse-proxied to 443 the page loaded from `https://<domain>/` while SSE pointed at port 8787, which is not exposed publicly, and the activity feed kept reconnecting. It now depends on `NODE_ENV`: production defaults to same-origin, and only `next dev` keeps `:8787` to work around Next.js buffering SSE; the `NEXT_PUBLIC_SSE_BASE` override remains. The README now documents reverse-proxy deployment.

### Findings

#### Fixed

- **Fixed the asset list in the "By asset" view having no scrollbar when it overflows**: the outer card only had a `max-height` and no definite height, so the scroll viewport's percentage height could not be resolved, and with many assets the list either overflowed the card or was cut off without scrolling. The height limit now sits directly on the asset tree's native scroll container and adapts to the window height.

### Database

#### Fixed

- **Capped the connection pool**: `database/sql` does not limit how many connections the application itself may open by default; when the pool has no idle connection it unconditionally opens a new one, all the way up to PostgreSQL's `max_connections` (default 100) before being refused. It is now capped at 32, and queries beyond that wait for an idle connection, so the same load becomes slower instead of failing; if `max_connections` has been lowered, lower this accordingly.
- **Improved connection reuse**: the default of `MaxIdleConns` is 2, so with more than 2 concurrent connections they were closed after use and the next request had to redo the TCP and PostgreSQL authentication handshake. The idle limit is now equal to the total limit, plus a 30-minute connection lifetime and 5-minute idle eviction, letting the pool naturally replace long-lived bad connections.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.14] - 2026-09-24

### Task list

#### Added

- **New "Findings" column in the task list**: shows the counts per severity tier (Critical / High / Medium / Low), with non-zero tiers coloured by severity, so the size and distribution of each task's findings is visible at a glance.

#### Changed

- **Narrower "Description / Goal" columns**: overly long content is truncated with an ellipsis and the full text is shown on hover, so long text takes less horizontal space in the list.

### Exploration graph and planning situation overview

#### Changed

- **Slimmed down the planning situation overview (graph_overview) and capped every list**: recent facts, finished intents, pending intents, cold-zone digests and confirmed finding details all switched to "latest window + count fallback", and what is not shown can be queried on demand; this markedly reduces the LLM context size per round and keeps long tasks from bloating the context (the cold zones of related-task overviews are limited too).

#### Fixed

- **Removed reverse duplicate edges between digest and finding in the exploration graph after cold nodes are collapsed**.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.13] - 2026-09-19

### Asset blocking

#### Added

- **New global asset blocking rules (blacklist)**: domains / IPs / URLs with exact or fuzzy matching and CIDR ranges can be entered, with create/read/update/delete and enable/disable for rules; the management page is under "System → Asset blocking". Government (`.gov` / `.gov.cn`) and education (`.edu` / `.edu.cn`) sites are fuzzy-blocked by default.
- **Asset blocking wired into the execution chain**: before the agent dispatches an intent (`add_intent`) or inserts assets (`insert_assets`), the target assets are checked against the blocking rules: blocked intents are not dispatched, blocked assets are not inserted, and the asset info and the blocking reason are returned to the agent.
- **New task-level block / allow (whitelist) rules**: independent of the global rules and effective only for this task, evaluated "block first, then allow": a block match forbids; if nothing is blocked but the task has allow rules and none of them match, the target is "not allowed to be tested"; with no allow rules the whitelist is not enabled. They can be entered when creating a task, or added, edited, deleted and enabled/disabled in the task details "Overview".
- **Task templates support a preset category and task-level block/allow rules**: a template can save the task category and a set of task-level rules, which are carried into the new task form when the template is applied.

### Operation review

#### Fixed

- **Tightened the model judge's output protocol to reduce false allows caused by truncation**: the verdict comment limit was lowered from 500 Chinese characters to 120 Chinese characters, and "output only JSON, no preamble or code block" is enforced, so a verdict truncated by `MaxTokens` no longer fails to parse and then gets allowed through the model failure policy (fail-open).

### Task archives

#### Fixed

- **Archiving skips symbolic links instead of failing the whole archive**: the archive format only supports regular files and directories end to end, and previously any symbolic link in the working directory made the whole task archive fail; the symbolic link is now skipped and logged, and the remaining files are archived normally (links are not followed and nothing leaves the directory tree).

### Account and compliance

#### Added

- **New "Terms of use and disclaimer" dialog before login**: you must tick the agreement checkbox before you can log in.

### License and dependencies

#### Changed

- **The project adopts the AGPL-3.0 license**, and the license and disclaimer section of the README was improved.
- **Upgraded norma to v0.4.1**.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.12] - 2026-09-17

### Exploration chain broadcast board

#### Added

- **New "Exploration chain broadcast board" on the task details page** (#144): presents the task's exploration nodes (origin/goal/intent/fact/finding/hint/compaction) as a timeline feed, with filtering by type, keyword search, ascending/descending order, pagination and auto-refresh; while on "the first page, newest first" it is the live position and refreshes every round, and when you leave that position it only accumulates an unread count without disturbing your reading, with "N new broadcasts · back to latest" to return in one click. Entries are grouped by day, so even when paging through a long task you can tell "which day this happened".
- **Each row of the broadcast board shows the node id** (#145), to make it easy to cross-reference the exploration chain graph and locate a specific node.
- **Expanding a node in the broadcast board shows upstream/downstream nodes and anchored assets** (#147): expanding a broadcast shows the node's upstream (where it came from) / downstream (what it produced) relations, and hovering over a related entry pops up that node's card (type/status/source/time/summary/payload excerpt); the assets the node is anchored to are also listed (type tag + recognisable text). The related data is delivered with the broadcast page, so expanding sends no extra request.
- **Broadcast board search supports filtering by node id** (#150): besides "Content / Source", the search box now also matches node ids; type a plain number or the "#41" form shown in the UI to pinpoint that node.

### Intent management

#### Added

- **Intent deletion supports two modes, "soft delete / hard delete"** (#149): intents that are pending, running or paused can all be deleted, a reason is required, and the delete mode is chosen in the confirmation dialog.
  - **Soft delete (default)**: the intent is set to "Deleted" and the reason is stored in a separate field; the intent node and all its outputs and lineage are kept.
  - **Hard delete**: physically removes the intent and the exclusive descendant nodes "that depend only on it" (cascading along the output / intent chain down to the leaves), so no orphaned data is left; the deleted intent's token metering is kept, archived under the original dates; shared nodes (still referenced by other intents), goals and the task's root facts are always kept, and the hard delete dialog shows how many nodes the cascade is expected to affect.

  Both modes notify the planner that "the intent was deleted by the user + the reason", and it replans accordingly.

### Operation review

#### Added

- **Approval records can be filtered by status and decision source** (#139): approval records can be filtered by approval status and by decision source to find a record quickly.

#### Fixed

- **Pending approval requests load independently of history pagination** (#133): pending requests are no longer affected by the history list's pagination and stay fully visible while you browse the history.

### Agent

#### Changed

- **The worker role description now uses generic cybersecurity-platform wording** (#138).

#### Fixed

- **Fixed cold-node compaction never triggering**: the Compactor is now wired into the per-task planner; cold-node compaction (cold-digest) never ran before because it was not connected, and now works again.

### Chat

#### Added

- **Chat supports @-mentions of several record types with scroll pagination** (#135): several types of records can be @-mentioned in chat, and the mention candidates load with scroll pagination.

#### Fixed

- **Long message bubbles are constrained to the conversation panel** (#137): overly long message bubbles no longer overflow the conversation area.
- **Fixed uploading a file before a new conversation is created failing with "missing upload file"**: the Composer's file picker now snapshots the `FileList` into an array before clearing the input and calling back; previously the draft state first had to create the session asynchronously, and by the time execution resumed, the `FileList` live-bound to the input had been cleared, so the upload lacked the file field and the backend returned 400.

### Traffic

#### Fixed

- **The traffic recording proxy listens only on 127.0.0.1 by default** (#129, #130): prevents the default configuration from exposing an open proxy on other network interfaces.

### Web

#### Fixed

- **Fixed the task list page losing the global header in the static export build**.
- **Added the missing linked-traffic mock for the demo finding details page, fixing a blank screen**.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@RuoJi6](https://github.com/RuoJi6)
- [@dingpotian](https://github.com/dingpotian)

## [0.3.11] - 2026-09-15

### Operation review

#### Added

- **Approval records can jump to their source** (#125): clicking "Source" on an approval record jumps back to the exact tool execution that triggered the approval: it opens the original full session, paginates automatically to the target position, expands the command and result in place and highlights it centred in the scroll area, keeping the surrounding messages readable; automatic correction stops when the user scrolls manually. Across plain chats, task workers, the planner and segmented main-agent sessions, the location is resolved precisely through the persisted `tool_use_id` and task mapping (with a new scoped call-ID index); when the record is missing, duplicated or ambiguous, an explicit message is shown instead of jumping to another execution. Clear messages are also shown when the session was deleted or the task was archived / the record is missing.
- **Approval records support pagination** (#115).

#### Changed

- **Slimmed down the model review input** (#124, #125): the input of model review (the LLM judge used when no rule matches) is narrowed to a versioned JSON of "the current complete tool call + explicitly selected short background + the local working directory". The background only takes real user messages (the current user message of the chat / task main agent); workers no longer attach the intent summary and also drop background inherited from the parent agent; the planner and automatically triggered sessions do not fabricate user messages. The task description, goals, operation constraints, global exploration situation, call history and the worker's full intent are no longer attached; these are still used as before for agent execution and independent session auditing, they just do not go into operation review. Every verdict must output JSON `decision`/`comment`, and the comment must include "the actual operation, the consequence if successful, the matched rule"; instructions inside arguments or background cannot change the review policy. A snapshot and fingerprint of the input actually sent to the model are saved; old snapshots are kept and labelled with their version, and old inputs are never reconstructed from current data.

#### Fixed

- **Model verdicts wrapped in a code block are no longer silently allowed** (#126): if the verdict JSON returned by the model was wrapped in a ``` code block, the parse failure used to be silently allowed through the model failure policy; the code fence is now stripped before parsing, and only if parsing still fails is the configured failure policy applied.

### Agent

#### Added

- **New experimental noa context compaction** (norma upgraded to v0.4.0): an experimental feature that can be turned on in system settings, off by default. When on, noa (model-driven context compaction) takes over context compaction for the four agent kinds (main agent, planner, worker, chat), replacing the built-in compaction; the compacted originals are archived persistently, all under `<workDir>/noa/<session ID>/` (not scattered across task directories), with one globally unique directory per session ID. If wiring it up fails it falls back to the built-in compaction automatically without interrupting the real task; the switch is read once per run, so toggling it only affects runs started afterwards.

#### Fixed

- **Exploration graph tools refuse instead of crashing on nil without a task context**: calling exploration-graph tools outside a task context returns a clear error instead of crashing on a nil store dereference.

### MCP

#### Added

- **Support for legacy SSE MCP servers** (#117): compatible with MCP servers that only offer the legacy SSE transport.

### Traffic

#### Fixed

- **Traffic search matches record hosts port-aware** (#114): host matching in `traffic_search` now includes the port, so records of the same host on different ports no longer bleed into each other.
- **A failed `traffic_search` description migration no longer interrupts the following reporter migrations**: a single failed migration is isolated and does not affect the migrations after it.

### Web

#### Changed

- **Dividers between finding options in task retest** (#122): separators were added between the finding choices in retest for visual clarity.

#### Fixed

- **Fixed the whole demo task details page crashing**: in mock mode the task details "Sessions" tab fetches `GET /api/tasks/<id>/side-questions` (side question history), but the mock handler had no such route, so the read fallback returned `[]` under the rule "a path ending in s is a collection", leaving `data.items` as `undefined`; the side-question hook's `merge()` iterated over it and threw `TypeError: t is not iterable`; the exception happened inside the `setItems` updater and was rethrown by React in the render phase, where the caller's `catch` could not catch it, so the error boundary took over the whole page and showed "This page couldn't load". The mock handler now explicitly returns an empty side question history, and `sideAPI.history` also normalises its return value (a non-array `items` always falls back to `[]`) as defence in depth.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@RuoJi6](https://github.com/RuoJi6)

## [0.3.10] - 2026-09-13

### Network

#### Added

- **New official DeepSeek source for web search**: reuses the currently active LLM configuration directly. It differs in nature from the other three sources: DeepSeek has no directly callable search API; search only exists inside its Anthropic-compatible API (the `web_search_20250305` server tool) and is executed by the DeepSeek server. It therefore **only supports the official DeepSeek endpoint + the anthropic protocol** (OpenAI-protocol endpoints reject server tools outright), and each search **costs one extra model call**, the request **does not go through the search egress proxy** and **is not recorded in the traffic trail**, and results **contain only titles and links** (no snippets; fetch the body with WebFetch when needed). The settings page explains these limitations but **does not validate or block**; it is up to the user to confirm they are met, and the "Test search" button runs one real search to verify.

### Agent

#### Added

- **Workers can look back across works**: new `search_all_worker_traces` (search the execution of every work in this task by keyword for matching steps, without needing an intent_id first) and `get_worker_trace` (once a work is picked, list its step stream, search it in place by keyword, and fetch full content by step_id), used to reuse observations other works saw but did not write into a fact, avoiding duplicate effort.
- **`node_detail` is now available to workers**: together with the look-back tools above, a worker that has an intent_id / node id can query that node's full details directly.
- **Planning rounds triggered by `add_hint` are announced explicitly**: previously a new hint was only folded into the situation overview for the planner to discover on its own; now an `add_hint` records a trigger for the planner saying "the human added N strategic hints: …" (a batch counts as one, no flooding per hint), and the planner is told explicitly that "this round was triggered by new hints" and sees the hint content directly.

#### Changed

- **The global situation hint now uses a "loosened" tone**: it encourages divergent exploration and timely reporting of cross-intent leads instead of converging too early.
- **Streamlined the worker boundary wording**: being blocked the first time does not mean the path is exhausted; the focus is on "working through the bypass techniques within this intent before drawing a conclusion".
- `insert_assets` drops the per-asset `related` argument: its only purpose was to decide whether to add the asset to this task's scope, and the value was not persisted (it became void as soon as the same asset was registered again, and the UI did not show which ones were judged unrelated), so in practice it only made the model make one more judgement that could not be kept.
- **Test scope (`task_scope`) is no longer affected by the asset coverage switch**: automatic scope entry from `insert_assets` (`source='auto'`) runs whether coverage is on or off, and `add_task_scope` is always available to the planner / in-task main agent / goal decomposition agent. Scope is the task's authorization boundary and the filter basis for asset queries; the coverage switch only decides whether to use it as the denominator for metrics, not whether to accumulate the scope itself. Previously turning coverage off disabled both write paths, `auto` and `agent`, leaving `task_scope` with only rows added manually in the UI. `list_untested_assets` is still hidden when coverage is off (it is a purely coverage-oriented view).

#### Fixed

- **Fixed assets bleeding between tasks** (#59): `list_assets` used to hard-code the task id as 0 and query the whole shared asset store, and the model had no way to write a scope filter, so it treated other tasks' assets (especially IPs) as this task's targets and the testing direction drifted. It now only returns assets within the test scope (`task_scope`) of **this task and its directly related tasks**, matched by **ownership** rather than literal value: if the scope contains a root domain, all subdomains/services/endpoints under it can be found; if it contains a network range, the hosts and services in that range can be found; fetching an out-of-scope asset directly by id is not possible either. Non-task contexts (Auto/pentest) have no scope to rely on and still fall back to the whole store. This also fixes an ownership blind spot where direct-IP hosts (such as `http://1.2.3.4/api`) could not be matched by a network-range scope. The UI's "Assets" view (filtered by task producer) is not affected.
- **Fixed the worker cross-work look-back tools being removed by mistake**: after `search_all_worker_traces` / `get_worker_trace` (and `node_detail`) were added to the worker's default tool set, an old migration that "narrows the worker tool surface" unbound them again at startup, so workers never actually got these tools. They were removed from that unbind list, and databases that already ran the old migration get them bound back to the worker once.
- **Fixed occasional persistence failures of `/btw` side questions**: NUL (`\u0000`) escapes, which JSONB does not support, are stripped before the side_question checkpoint is persisted, so content containing that character no longer fails to write.

### Triggers

#### Fixed

- **Merged trigger sessions deduplicate task description/goals per task**: when triggers from several tasks are merged, the same task's description/goals are no longer concatenated into the message repeatedly, so long goals do not pile up and blow up the context.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.9] - 2026-09-11

### Agent

#### Added

- The in-task main Agent supports **multiple sessions**: create, switch and reset context independently, and every session is interactive.
- Added persistent `/btw` **side questions**: ask follow-ups without interrupting the main thread; questions and answers are stored in the database and survive restarts.
- `spawn_task` adds `source_task_ids`, so a new task can **inherit read-only** the assets and findings of its source tasks.

#### Changed

- Disabled cross-engagement memory for workers and narrowed their default tool surface: reading context and cross-work retrospectives are the planner's job; a worker only executes a single intent and writes back its results.
- Trimmed the default worker prompt; `get_worker_output` drops the `terminated` and `worker_name` fields; trimmed the descriptions of `insert_assets` / `list_assets`.

#### Fixed

- Fixed works ending early because of **idle turns**: the model sometimes spends a whole turn only thinking, producing neither body text nor tool calls; the harness sees this as a natural finish (`end_turn` with no `tool_use`) and wraps up directly with `completed` and an empty summary, so an unfinished intent breaks off halfway, showing up as "the task ended normally but without any text summary". None of the five LLM retry layers could reach it: it is not an error; the same-provider safe-window retry is entered on "stream failure", the circuit breaker treats `err == nil` as success, and intent reruns only recognize `model_error`; the SDK's empty-response retry can't reach it either, because that layer judges emptiness by "whether any event was yielded", and thinking deltas are themselves events. Now the work's Stop hook detects such turns and injects a continue instruction, so the model carries on to the next step with the thinking it has already produced. "Resend as is" was deliberately not chosen, because these idle turns are usually determined by the prompt and the shape of the context - stable behavior rather than random glitches - and resending would only make the model think it over again.
- The count reuses the **empty-response retry count** under "Retry & backoff" on the LLM page (both answer "the model finished but produced no substantive content", just with different criteria and means); the default is 2, and `-1` turns it off, reverting to the previous "idle turn = wrap up" behavior. It is a **total** cap per intent, not a consecutive count: the harness itself already limits consecutive idle turns to a single nudge, and the quota is only refreshed after a real tool turn, so this number guards against loops like "Tool → idle → nudge → Tool → idle" exhausting the intent budget. When triggered, the log records `[work <worker> · #<intent>] idle turn…injecting continue instruction (n/N)`. Design in `docs/LLM重试设计.md` §1.1.
- Fixed the context budget and input layout of `/btw` in long conversations; in non-secure contexts (non-HTTPS access), side-request IDs are generated via a fallback.

### Traffic

#### Added

- Findings can **link multiple traffic evidence items**, which can be ordered, annotated and tagged by role (request/response/supporting).
- The report Agent **automatically links** relevant traffic evidence before writing the report.
- Added an Agent **traffic binding switch**, and completed the hand-off of evidence between Agents.

### Tasks

#### Added

- Added **session-level finding retests**: retests run in a dedicated Agent session, and the list and detail views show their run status.

### Intercept

#### Added

- Approval records gain **details and an execution audit**: view the tool request context, the initial model/rule verdict, the execution output and the parameter fingerprint.

### Assets

#### Added

- Task test assets support **DSL search**.

### LLM

#### Fixed

- Fixed the connection test not sending the custom session header, which made opencode zen return 400.

### Network

#### Added

- MCP's HTTP transport can **skip TLS certificate verification**, making it easier to connect to services with self-signed certificates.

### UI

#### Added

- The session list is grouped by Agent, with expand/collapse and independent pinning; conversations can be filtered by Agent.
- The attack path graph renders compaction (digest) nodes and collapses their members.

#### Fixed

- Fixed a blank screen caused by out-of-sync login credentials.
- Interception notices now explicitly say "platform-controlled", so they are not mistaken for defenses on the target side.

### Deployment and updates

#### Added

- Added **one-click update from the UI**: the system settings page has a new "Version & updates" card, and the top bar shows a notice when a new version is available. The flow is: download the release package → verify `SHA256SUMS` → smoke test → stage → exit and let the supervisor script relaunch to complete the swap; the page refreshes automatically.
- Added the supervisor launch scripts `start.sh` / `start.bat` as the official entry point (included in both the release packages and the Docker image; `install.sh` is unchanged); they decide whether to relaunch based on the exit code and forward SIGTERM to artex. All verification and swap logic lives in Go, keeping the scripts dead simple.
- Automatic fallback on failure: if verification or the smoke test fails, the update is discarded and the current version keeps running; if the new version fails to start 3 times in a row, it rolls back to the previous version. The settings page also offers a manual roll back (note that the database schema is not rolled back).
- Updates only accept GitHub domains and enforce HTTPS; the release source is not configurable; one-click update is disabled in development builds. GitHub query results are cached for 30 minutes so the top-bar notice does not exhaust the API quota.

#### Known limitations

- Under Docker only the program is swapped, not the image: the toolchain is not upgraded along with it, and recreating the container reverts to the version bundled in the image; use `docker compose pull artex` when needed.
- `skills/` in the release package is not synced, so built-in skills added in a new version do not take effect automatically.
- An update means a restart, which interrupts running tasks.

### Dependencies

#### Changed

- Upgraded norma to v0.3.7.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@RuoJi6](https://github.com/RuoJi6)

## [0.3.8] - 2026-09-09

### LLM

#### Added

- The LLM page adds a "Retry & backoff" tab: both the **count** and the **interval** of all five retry layers are configurable. A failed model call passes, from inner to outer, through five layers: connection retry (SDK; connection reset / timeout / 429 / 5xx before the stream starts), empty-response retry (SDK; finished normally but with no content at all, openai format only), same-provider safe-window retry (replay after a stream drop before any output was delivered to the caller), round-robin circuit breaker (cool down and skip once consecutive failures reach a threshold), and intent rerun (rerun the whole intent after the worker ends with model_error); an outer layer only kicks in once the inner one is exhausted. Each layer has two knobs with uniform semantics: empty = use the original default count and exponential backoff; a count = use that count; an interval = replace exponential backoff with a fixed interval; -1 = disable that layer's retry. The first three layers follow the endpoint and can override the global defaults field by field in each model configuration (one that pins only the interval still inherits the global count); circuit breaker and intent rerun are process-level, with a single global setting only. Changes take effect on save, no restart needed. Leaving everything empty keeps the current behavior, and upgraded databases are byte-for-byte unchanged (new columns default to 0, and a missing settings key means all defaults). The connection test deliberately ignores these parameters - it has a hard 30s timeout, and stacking user-configured retries on top would only make a working endpoint fail the test with a timeout. Design in `docs/LLM重试设计.md`.
- Each LLM configuration supports a custom **session header** (`session_header_key`): when non-empty, every LLM request carries that HTTP header, with the session id of the current run as its value (`conv-<id>` for chat sessions, `exp<x>-worker-i<intent>` for workers, etc.), for gateways that do prompt caching / sticky routing based on a session-id header. The session id is read from the request context and injected, with no norma changes needed, so the same shared provider can send different header values per session. Includes a migration for existing databases; the frontend LLM configuration dialog gains an input field.

#### Fixed

- Fixed saving an LLM configuration failing with `23502` when the session header field was empty: the column is `NOT NULL DEFAULT ''`, but `NULLIF($n,'')` was wrongly applied, writing an unfilled session header as NULL and violating the not-null constraint; it is now passed through with empty-string semantics.

### Agent

#### Added

- Wall-clock timeouts now **wrap up in place**: relying on norma v0.3.6, when `MaxDuration` is reached the running tool is interrupted and the run continues on the live ctx for the wrap-up rounds (writing back identified content + a summary, with final state timeout), instead of relying on the external hard ctx of `maxDur+90s` in worker/planner to kill a stuck run outright as `aborted_tools`. Chat goes through the same harness and gets the same behavior automatically; mainagent has no `MaxDuration` and is unaffected.
- Stall fallback: when the planner wakes on a heartbeat / no-change wake-up and the whole graph has no open or running intents, its opening message becomes a stall alert, stating explicitly that no worker is running and no direction is queued, and that this round must produce one or more non-duplicate new intents (producing 0 intents is not allowed).

#### Changed

- Restructured the worker prompt: the intent / launch instructions / raw JSON of the anchored assets moved into the system prompt, rebuilt every round and never compacted away, so continuing no longer depends on the transcript's first message being retained; the launch user message is slimmed down to just the global situation overview (degradable, tolerates staleness). The cost is that the system prompt now mixes in per-intent data and loses cross-intent cache reuse - a deliberate trade-off for "never lose the intent".
- Trimmed the default planner / worker body text and fixed several issues seen in practice: the planner treats `recent_done` differently by status (for blocked/exhausted, check the trace first before deciding - neither treating it as a dead end nor blindly rerunning), negative conclusions become "observation / doubtful, not conclusive" and their evidence must be checked before accepting them, it must produce intents when the goal is unmet and there are no open/running intents (hard floor), and depth takes priority over coverage; the worker writes negative conclusions only as "observation + tentative reading", leaving the verdict to the planner, and writes cross-intent leads into the fact's summary for the planner instead of chasing them itself. Reseeding appends the new defaults as a new version and switches to it; user customizations / old versions are kept in history and can be rolled back to.
- Narrowed the work agent's default toolset and the asset write-back prompt: a worker only executes and writes back a single intent, while reading context / cross-work retrospectives are the planner's job, so `list_facts` / `node_detail` / `list_companies` and cross-work search (`search_all_worker_traces` / `list_worker_traces` / `get_worker_trace`) were removed from its default tools, leaving only `list_findings` (dedupe check before reporting a finding) + `add_finding` / `record_fact` + `insert_assets` / `list_assets`; stale field descriptions in the prompt that conflicted with the `insert_assets` schema (`type=tech`/`on_url`/`props`) were deleted. Existing databases get a one-time migration that strips the corresponding bindings; planner/main bindings with the same names are untouched.

### Exploration graph

#### Added

- **Exploration graph cold-node compaction (cold-digest)**: old, long-inactive intents / facts are folded into digest nodes shown in `graph_overview`; the original nodes are kept permanently and can be fully restored by id (lossless storage, only the presentation is compacted, folding is reversible). Hot/cold is determined by reverse reachability, where any live branch makes it hot, with R=6 rounds of debouncing and connected-component grouping; background compaction (minor folds uncovered cold blocks, major goes back to the source to recompact and merge fragments) includes activity re-checks and cooldown mutual exclusion, never touches the hot path and never overwrites revived nodes. The overview provides `cold_digests` and an asset-indexed `cold_index`, with `expand_digest` / `expand_index` handling restoration. Overviews of linked / inherited tasks likewise reuse their own folded views, and `expand_digest` supports read-only cross-task restoration. `expand_digest` / `expand_index` are only given to the planner and the main agent, not to workers. All include migrations for existing databases.
- `graph_overview` outputs the full `finding_list`: findings are a task's most valuable output and a single task usually has few of them, so the overview now carries all of them (unlike facts, which only get a recent window); the planner/worker can see every confirmed finding at a glance each round without calling `list_findings`. Each entry is trimmed to `{id, summary, evidence?, from_intent?, assets?}`, where affected assets are given as readable content (url / domain / ip:port) instead of bare ids.

#### Changed

- `graph_overview` no longer lists `hosts` flat: the coverage block drops the host list (in large-scope tasks each round carried up to 500 host strings, of limited value for planning decisions) and keeps only `host_count`; specific hosts can be looked up with `list_assets` on demand. Added a top-level `done_intents_total` (total number of finished intents), parallel to `recent_done_intents`, which is truncated to ≤15, so the planner knows whether anything was truncated when deduplicating.

### Tools

#### Changed

- The default binding of `add_company_scope` moved from worker to planner: defining a company's asset scope is the job of planning / main control / Auto, while workers only execute exploration. New databases seed the default bindings as mainagent/planner/auto; existing databases get a one-time migration.
- The planner binds `list_assets` by default: it now has both `list_assets` (DSL search across the whole database) and `list_untested_assets` (untested assets in scope); existing databases get a one-time backfill that does not override user unbindings.

### Tasks

#### Added

- The task list adds a "Running workers" column: it counts the intent nodes with `state='running'` under the task, using exactly the same definition as "Running workers" in the task detail overview, and shows 0 when no worker is running.

### Network

#### Added

- Added a **global egress proxy** setting: all target traffic can go out through a single global proxy (http/https/socks5, with `user:pass` support). With traffic capture on, it acts as the upstream of the MITM recording proxy (traffic is recorded as usual and then sent out via the proxy; both the intercept and the passthrough paths use the upstream, so the source IP is not leaked); with capture off, it is injected directly into the agent's bash environment and WebFetch (`proxyEnv` adds `ALL_PROXY` to support socks5). The setting is stored in the settings KV table (no migration needed); the frontend system settings page gains a "Global proxy" card, independent of the web search proxy and the LLM proxy.

### UI

#### Fixed

- Corrected the semantics of the intent status labels: `exhausted` "Exhausted" → "Budget exhausted" (it actually means it was cut off midway on reaching the step / time budget and only wrote back partial results, not that the direction had been fully explored), `blocked` "Blocked" → "Errored" (it actually means model / API / network failures used up all retries and the intent was barely explored, not that the target / a WAF blocked it), and added the previously missing `stopped` "Stopped" (a work manually stopped by the user).

### Dependencies

#### Changed

- Upgraded norma to v0.3.4: MCP tool output gains truncation and spill-to-disk (see `651b961`); the later v0.3.6 enables in-place wall-clock wrap-up.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.7] - 2026-08-31

### LLM

#### Added

- Model configurations add "Max output tokens", plus a choice of which request field name carries it: the limit caps how many tokens a single reply may generate and is sent with every request; 0 (default) = the field is not sent and the server default applies. It is a different thing from "Context window" - the latter is the model's total capacity, used only locally to compute the compaction threshold, and never appears in requests. The field-name switch only matters for the `openai` (Chat Completions) format: empty (default) sends `max_tokens`, which is the only one most compatible gateways accept; OpenAI's official reasoning models (o series / GPT-5) conversely accept only `max_completion_tokens` and reject `max_tokens` outright with `unsupported_parameter`, so such endpoints must be switched to the new field manually. The other two formats each have a fixed field name (`max_tokens` for Anthropic, `max_output_tokens` for the Responses API), so for non-openai formats the switch is greyed out and cleared on save. This also wires up a path that was never connected before: none of the five places - planner / worker / chat / main Agent / goal decomposition - ever set an output limit; the openai family didn't send it at all and Anthropic fell back to the SDK's 8192, so adding the setting without wiring this path would have left any number entered without effect; now the value is resolved from the configuration every round, just like "Streaming output", so after a failover switch it takes effect on the next round. Upgraded databases behave exactly as before (new columns default to 0 and an empty field name).
- Clicking "Test" in the admin UI now writes each HTTP attempt's status code and the gateway's raw response body to the server log (body trimmed to 4K), making it easier to diagnose 401s, quota messages, empty frames, returned HTML pages and the like, instead of only seeing the collapsed ok / err in the UI. This logging does not depend on the "LLM logging" switch.

#### Changed

- The task LLM configuration chain can now be modified in any state, no longer restricted to "running / paused / config chain exhausted": after a task ends (done / failed / timeout), main Agent conversations still use this chain, so previously if a model on the chain broke it could neither be changed nor could the interaction continue. The terminal-state checks in both the backend HTTP layer and the DB transaction are removed, and the frontend dialog also allows editing and saving for terminal tasks. Saving a terminal task no longer reopens quota-blocked intents (those intents would be moved to open with no worker to execute them, and would no longer qualify for "Rerun intent"); to keep running, use rerun intent / add goal, which bring the task back to the running state.

### Agent

#### Changed

- "Message a running worker to steer it" now reuses the existing pause / resume + transcript resume mechanism and behaves the same as main Agent conversations: previously it used a home-grown intervention persistence protocol that touched the scheduling barrier, the resume flow and more than ten activity query filters. Now messages are injected via the next round's input, and the intent runs directly in a dedicated goroutine, not limited by the 3-slot worker pool and running as soon as a message is sent; the frontend keeps the message box and restores the "Resume" button, with sending now carried over SSE. No DB schema changes. Trade-off: messages are kept only in memory with no crash recovery, and sending a message may briefly put the task one worker over its concurrency limit (a rare scenario, acceptable).

### Tasks

#### Fixed

- Fixed out-of-memory (OOM) crashes when archiving large tasks: archiving now streams the snapshot to disk instead of loading the whole task into memory at once. Also closed three recovery gaps on the cold archive path - on modern installs traffic lives only in SQLite, and a crash between the PostgreSQL commit and the SQLite commit used to leave an archived task's traffic stranded in hot storage with no way to recover it; now a staging journal is written whether or not a history directory exists, and a missing `journal.json` is treated as discardable.
- Fixed system sluggishness when there are many tasks: loading conversations and loading the UI had noticeable delays. Queries for the task list, task context and exploration records were optimized together, and the frontend dashboard, conversation page and task detail page now make fewer duplicate requests.

### Assets

#### Changed

- Removed the "at most 256 rules" limit on company asset scopes: companies that enter their scope one IP / domain at a time easily hit this cap, after which the only option was to split into multiple companies, while the scope itself does not get slower with more rules. The limit was removed in all three places - frontend, backend and the demo mock; a single rule is still limited to 1024 characters, and the 2 MiB request body limit stays as a backstop (roughly 40,000-50,000 rules).

### Skills

#### Fixed

- Fixed uploading a skill archive failing with "Upload failed: zip: unsupported compression": the Go standard library only ships Store / Deflate decompressors, so bzip2 and Zstandard archives written by compression tools at non-default levels could never be extracted. These two decompressors are now added (pure Go, no new external dependencies); methods that genuinely can't be extracted, such as Deflate64 / LZMA / XZ / PPMd, as well as encrypted archives, now produce a Chinese-language message before extraction that names which file uses which compression method and how to repack it, instead of throwing the low-level English error at the user.
- Fixed skill file name validation rejecting Chinese file names as illegal: path validation used to be an ASCII allowlist of `[A-Za-z0-9-_./]`, so a single Chinese-named file in an archive (something like `参考/说明.md`) made the whole upload fail with "Archive contains an illegal path". It is now a Unicode denylist: file names in any language and spaces are allowed, while control characters, invalid UTF-8, zero-width and bidirectional control characters (RLO file name spoofing), `\ % # ? * : " < > |`, and `..` / absolute paths / empty path segments are still rejected; directory traversal protection is unchanged. Skill names are relaxed likewise - ASCII is still limited to lowercase letters, digits and hyphens (agentskills.io spec), Chinese and other non-ASCII letters can be used directly in skill names, but spaces, dots and path separators are not accepted.
- Fixed Chinese archives made by Windows compression tools ending up with garbled file names after extraction or being rejected entirely: such zips don't set the UTF-8 flag and write file names in GBK; they are now decoded with GBK as a fallback before path validation. Quoted frontmatter such as `name: "中文技能"` now also yields the correct skill name.

### UI

#### Added

- The Findings page adds a flat "All findings" view and makes it the default, switchable with the original "By task" view via header tabs: in the grouped view you had to expand tasks one by one to see their findings, which is a detour when you just want to scan the list across tasks. The flat view is one large cross-task table (10/20/50/100 per page) that behaves exactly like the grouped view - select to export, expand rows inline for evidence and the detailed report, edit name/category/severity inline, change disposition status, dig deeper, delete. Both views share the stat cards and the filter bar, switching keeps your filters, and the current view and filters are remembered locally; polling only hits the current view, and inline edits are written to both caches, so switching never shows stale data.
- The Findings page adds a "By asset" view: an asset tree on the left (company → root domain / IP → subdomain → service → endpoint; the company level only appears when assets actually belong to a company), and on the right the findings under the entire subtree of the selected node, sharing the same table and filters as the other two views. The tree only includes assets that have findings, filling in ancestor chains as needed (when a finding is attached only to the deepest endpoint, the levels above are still assembled), and node counts are aggregated over the subtree and deduplicated by finding; findings whose assets were deleted or that never had a linked asset go into an "Unlinked assets" bucket. Unlike the other two views, the asset view does not poll - it only queries when you enter the view, change filters, add/delete/edit findings on the page, or click the refresh button on the tree; the left tree is a navigation structure, so there is no need to recompute it every 5 seconds. Each tree level shows only the part relative to the level above (subdomains drop the root domain suffix, services show `https :443`, endpoints show only the path), with full values in hover tooltips and the breadcrumb; when there are too many nodes, the endpoint/service levels are dropped for that layer with a notice, and their counts still roll up into the level above.

#### Fixed

- Fixed the session transcript being squeezed and partly hidden in session details on mobile: on narrow screens the session list collapses, giving its width to the transcript itself.

### Dependencies

#### Changed

- Upgraded norma v0.3.2 → v0.3.3: adds `Config.MaxTokensField`, letting the OpenAI Chat Completions output limit be sent as `max_completion_tokens` instead (reasoning models only accept this key). The two keys are mutually exclusive and only one is sent; the default is still `max_tokens`.
- Upgraded `golang.org/x/mod` v0.37.0 → v0.40.0, fixing two dependency security alerts.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@neouks](https://github.com/neouks)
- [@begininvoke](https://github.com/begininvoke)

## [0.3.6] - 2026-08-27

### LLM

#### Fixed

- Fixed the "Non-streaming" toggle reverting to "Streaming" after saving and reopening (#69): the DTO of the config list API was missing the `streaming` field, so the response never returned it and the frontend, reading `undefined`, always fell back to the default streaming mode; the actual write and DB storage were fine, the value just could not be read back. The field was added back to the DTO (without `omitempty`, since `false` must also appear in the response).
- Test connection now verifies that the model actually replies, and tests using the config's real send/receive mode (#65): previously it only checked whether HTTP succeeded, so a request that went through but got zero reply from the model (thinking exhausted the budget / body swallowed by a safety policy / compatibility layer dropped `content`) still reported "Connection successful", inconsistent with the "no reply" behavior in sessions; also, the test always used streaming, so for non-streaming configs it was actually testing a different channel. Now an empty reply counts as a failure, a successful test shows the model's reply in the message, and the current streaming toggle is passed into the test, so that "Test passed" stays consistent with "the session actually works".

### Agent

#### Changed

- `list_facts` now paginates and supports keyword filtering, so a large number of facts no longer blows up the context in a single call (#74): returns the latest 20 by default, supports `limit` (max 100) / `before` cursor / `q` summary keyword, and returns `{facts, total, has_more, next_before}`; overly long summaries are truncated by character count (the full text is still available via `node_detail`). Worker / planner prompts were updated to the pagination semantics. Existing databases get the new parameter schema refreshed into the tool catalog table via a one-time migration (`SeedTool` only inserts on first run; otherwise the tool management page would show "No parameters").

### Tools

#### Added

- Added tool call count statistics to the "Tool executions" page (#72): the toolbar "Stats" button opens a dialog showing call count, share and failure count per tool (sorted by count, descending); it reuses the list's task / keyword filters, counts the whole result set rather than the current page, and only fetches data when the dialog is opened.

### Dependencies

#### Changed

- Upgraded norma v0.3.1 → v0.3.2: fixes reasoning/refusal being silently dropped from OpenAI-family responses (adds `reasoning_text` for Responses), deduplicates the three reasoning field names, adds bounded retries for empty responses (zero content blocks), and fixes gateway 400 errors caused by compaction boundaries splitting tool pairs (also repairing existing orphans already baked into transcripts).

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.5] - 2026-08-25

### LLM

#### Added

- Each LLM config supports a streaming/non-streaming toggle (streaming by default): on uses streaming SSE; off uses true non-streaming (`stream:false`, the full JSON returned at once), which works around some gateways' poor SSE implementations (empty frames, dropped thinking-field frames), at the cost of losing live progress and live token counts during runs. Worker / planner / mainagent / chat / goals all read the value dynamically from the currently active config; all three Provider wrapper layers (`llmpool` / `llmrec` / task runtime) are compatible with non-streaming; `llm_profiles` gets a new `streaming` column, with an `ALTER` backfilling old databases (default `true`, transparent for existing configs).
- Added support for LLM configs in the OpenAI Responses API format: each config gets a third format, `openai-responses` (calls `POST /v1/responses`), alongside Chat Completions / Anthropic; `BaseURL` normalization, default model `gpt-5`; the `format` constraint on `llm_profiles` adds `openai-responses`, with an idempotent migration for old databases; the frontend format dropdown adds "OpenAI (Responses API)". Dependency upgraded to norma v0.3.1 (includes the `reasoning_content` pass-back fix).
- Records raw HTTP LLM requests/responses: captures the real wire body at the HTTP transport layer, preserving tool schemas, `tool_use` blocks and raw SSE frames that the normalized view cannot show; each attempt from norma's internal retries is kept separately; `llm_records` gets new `raw_request` / `raw_response` columns, with an `ALTER` for old databases; the recording page's detail panel adds a "Raw" view toggle and request/response copy buttons (with an `execCommand` fallback for non-secure contexts).

### Chat

#### Changed

- Session list multi-select is now a "Select" mode toggle: by default the list no longer shows a permanent checkbox on every row (cleaner look), and the header becomes "N total" plus a "Select" button; clicking "Select" enters selection mode (checkboxes, select all, bulk delete), "Done" exits and clears the selection, and after a fully successful bulk delete it exits automatically (if any deletion fails it stays in selection mode for retrying); single-item rename / pin / delete still go through each row's ⋯ menu.

### UI

#### Changed

- Improved task management, session actions and traffic viewing (#57): task list column sort preferences are persisted, inline rename is triggered directly from an icon (no longer through a menu), and sheet (drawer) interactions and traffic view details were refined.

#### Fixed

- Worker asset labels show only domains and IPs, and empty labels are handled correctly.

### Agent

#### Added

- The planner adds a "quantitative acceptance check" when judging goals: when a goal has quantifiable acceptance criteria (asset test coverage reaching X%, capturing N flags, obtaining a certain privilege), it must check the measured values in `graph_overview` (`coverage.pct`, findings counts, etc.) before calling `prove_goal`; if the measured values fall short, `prove_goal` is forbidden and it must dispatch intents to close the gap instead, and it may not mark the goal met early on the grounds that "the main parts are done / it is largely achieved". Fixes a goal requiring 100% coverage being judged complete at a measured 40%.

#### Changed

- Rewrote the criteria for "0 intents this round" in the planner prompt: the original text described 0 intents as "the most common and most important principle", which made the planner stop too early while goals were unmet and untested surface remained in scope. Now 0 intents should only be produced in two specific cases: (1) every direction it can think of is already covered by open/running/recent_done intents; (2) the next step depends on output from currently running work that has not appeared yet (it should wait for that work to finish and plan at the next wake-up after the graph updates). Also added the reverse constraint: when there really is a new direction that is not yet covered and does not depend on running work, or the goal is unmet and untested surface remains, do not stop just because "0 intents is common".
- Strengthened the "evidence bar for negative conclusions" in the worker prompt: for negative conclusions such as "not injectable / port closed / no login entry" that could make the planner abandon an entire direction, the worker must first exhaust reasonable means within the intent (different encodings/parameters/paths/methods) before concluding; if the means were not exhausted or the evidence is weak, it must mark `confidence=inferred`, so that a hasty `observed` negative does not seal off an entire route (wrong negatives early in a task are especially likely to steer the direction off course and are hard to self-correct).
- The planner / worker default prompt changes above are appended as new versions and made current via one-time migrations (`reseedPlannerPrompt` / `reseedWorkerPrompt`, each guarded by a settings flag); old versions remain in the version history, and users who customized their prompts can restore them from there.

### Operations

#### Added

- Added `reset-password.sh` to reset the admin password (username fixed as `ARTEX`): supports both local / docker deployments; connection info can be given explicitly or read automatically from `--dsn`/`$ARTEX_PG_DSN`/`config.json`; it generates a bcrypt hash compatible with backend login inside the database using `pgcrypto` and writes it back to `settings.auth.password_hash`, with no service restart needed after the reset. The password is passed via an environment variable, never appears in the process argv, and is escaped to prevent injection.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@neouks](https://github.com/neouks)

## [0.3.4] - 2026-08-24

### UI

#### Added

- After selecting multiple tasks in the task list, their category can be changed in bulk; the target category can be "Uncategorized" to move tasks out of their current category; the whole batch is written in a single transaction, and the only possible failures are tasks deleted after being selected.

#### Changed

- The "Task category" field for new tasks changed from a dropdown to a searchable input: typing filters existing categories, a name not yet in the database can be created and selected immediately by pressing Enter (or clicking "Create" in the dropdown), and the selection is shown as a removable tag; still limited to a single category.

### Chat

#### Fixed

- Fixed sending a message being blocked by "LLM not configured, cannot chat" when the session had an LLM config selected but there was no globally active config. The pre-send check only looked at the global active config, while actual execution prefers the session's selected config, so the two resolution paths were inconsistent; they now share the same logic (session/Agent binding first, global as fallback).
- The "cannot chat" message is now broken down by state: with no configs at all it prompts "Add a config", with configs present but none active it prompts "Activate a config or assign one to this session", instead of always showing "Not configured", making the cause easier to pinpoint.

### Agent

#### Added

- For tasks whose goals are all met, intents dispatched by the main Agent via `add_intent` can be claimed and executed directly by Workers and stop once finished: the Planner no longer runs in this case (a task with no open goals does not enter planning), so it cannot re-judge the goals as met and cancel the just-dispatched intent; once the frontier drains, the task returns to completed. Before dispatching an intent, the main Agent asks the user, based on the intent's content, whether to register it as a formal goal; if it is registered, the task resumes normal autonomous planning.

#### Changed

- When the `step_ids` passed to `get_worker_trace` / `get_task_worker_trace` exceed the per-call limit (5), it no longer errors out; instead it returns the full content of the first 5 steps and reports via `returned_step_ids` / `omitted_step_ids` / `notice` which steps were returned and which were omitted, with the hint "no need to fetch more if this is enough". Duplicate and invalid ids are deduplicated and removed before counting.

#### Fixed

- The task list is now sorted by task id, descending (newest first), replacing the previous sort by creation time. Multiple tasks created at the same moment had identical timestamps and an unstable order, which, combined with 10-second polling and random iteration over an in-memory map, made them frequently swap positions in the list.

### Assets

#### Fixed

- Fixed company attribution recalculation being broken by a single row of dirty data: when `assets.ip` held a hostname (written by the Agent or the asset API), `a.ip::inet` threw `22P02`, causing adding/modifying company asset scopes and deleting companies to fail entirely and roll back. It now uses the safe conversion `try_inet()`, which skips invalid values instead of aborting the whole statement.
- Unparseable `ip` values are no longer silently skipped: after a company scope is saved, a clear message reports how many assets have an `ip` that is not a valid IP (with the specific ids and values), warning that these assets will not be attributed by IP/CIDR rules; the same information is also written to the server log, covering paths with no frontend response (deleting a company, scopesentry sync, Agent writes).
- IP/CIDR matching for task test scope also switched to `try_inet()`, replacing the previous regex guard that only checked the character set (hostnames made entirely of hex letters, such as `abc.def`, previously still slipped through and triggered the same error).

#### Changed

- The `ip` field of `ip`, `service` and `endpoint` assets no longer accepts hostnames: `insert_assets` and the asset API return a per-item error with its `index` and the exact fix (use `type=subdomain` and fill in `domain`, or resolve the A/AAAA records first), so the Agent can correct and re-insert on its own. Other assets in the same batch are unaffected and stored as usual.

### Contributors

- [@neouks](https://github.com/neouks)

## [0.3.3] - 2026-08-23

### Worker

#### Added

- Running Workers can be individually paused, resumed and cancelled; pausing keeps intents, facts and findings, while cancelling transactionally cleans up the current intent and its direct outputs after execution exits.
- Added the `paused` intent state, execution fences and named termination reasons, to prevent late blackboard writes after a pause, cancellation or task deletion.
- Added an optional task concurrency limit; new tasks, resumes, finding deep-dives and queue backfill all go through a single persisted FIFO admission path.

#### Changed

- The default wall-clock duration of a single Worker run changed from 600 to 1200 seconds; timed-out tasks restart the timer on their next actual execution after being revived.
- The real execution state of Workers, the Planner and the main Agent now uniformly drives the task status badge, fixing Workers showing "Idle" while running.
- Worker sessions keep per-item controls and the current session's token totals; the model name moved to the right of the current session title.

#### Removed

- Removed the Worker multi-select, select all and bulk pause/resume UI, along with the Worker bulk control API and Mock contracts.
- Removed the token badge and tooltip from Worker list rows; the underlying full token ledger and task aggregation APIs remain.

### LLM

#### Added

- Tasks support an ordered LLM config chain; when provider quota exhaustion is clearly identified, it automatically switches to the next config and persists the current config, exhaustion state and error summary.
- Running and paused tasks support editing the full config chain, reordering it and manually switching the current config, effective from the next LLM call.
- Automatic switches, manual switches and full-chain exhaustion are written as structured system activity and surfaced as deduplicated notifications through the task activity stream.
- Added a task role model resolution API that uniformly resolves the config and model used by the Main Agent, Planner and Worker for their next call.
- Added an optional global LLM Pool supporting a configurable call order, fallback for failures of a designated model, health status, cooldown recovery and manual reset.
- Added an always-on LLM usage ledger that aggregates input, output and cache tokens by task, session, model and config.

#### Changed

- Goal decomposition, the Planner, Workers and the main Agent share a task-level LLM runtime (resolution priority below).
- Failover responds only to explicit quota, balance or billing errors; ordinary rate limiting, authentication, network, server-side and context errors no longer trigger a switch by mistake.
- The LLM config page changed to a list of config cards with editing in a right-side drawer, and provides Pool round-robin order, priority, exclusions, health status and recovery actions.
- Config chain exhaustion info wraps on narrow screens; the current model changed from an icon in the session list to a text label next to the current session title with a full tooltip.
- The order in which roles within a task resolve their LLM changed to "Agent binding → task config chain → global": roles explicitly bound to a model always run on that model, unbound roles fall through to the task chain, and only when the task chain is empty do they fall back to global.
- Leaving the outbound proxy empty now means a direct connection, with no fallback to the `HTTP_PROXY`/`HTTPS_PROXY` environment variables (an explicit `ARTEX_LLM_PROXY` is unaffected); the proxy input supports `socks5://user:pass@host:port` with a username and password.

#### Fixed

- Transient streaming failures before commit (before any output has been produced) are safely retried with backoff on the same provider, greatly reducing cases of "interrupted after only one or two tools, no summary, final state `model_error`"; quota exhaustion, context too long and deterministic 4xx errors are not retried and are still handled by failover and compaction recovery respectively.

#### Removed

- Removed the LLM icon marker from the session list to avoid confusion with Worker status icons.

### UI

#### Added

- Tasks support creating, renaming, deleting and filtering by global categories; a category can be selected directly when creating a task.
- Added global task template CRUD and a right-side management drawer; new tasks can load a preset description and goals, or save the current content as a template.
- New tasks support linking multiple source tasks and multiple company asset scopes; company scopes are entered in a single multi-line text box that automatically recognizes domains, URLs, IPs, CIDRs, ICP numbers and company keywords.
- Task test assets can be added and removed in real time, recording their source (manual, company, inherited or Agent-discovered); a summary of the current test assets and their sources is shown next to the Worker session title.
- The findings page groups findings by task with independent pagination per group, and supports writing a description for a finding and creating a high-priority deep-dive intent.
- Chats support rename, pin, unpin and delete; the task list supports bulk pause and resume for the current page.
- Traffic details and tool execution details moved to a right-side drawer; HTTP messages fill in `Host` and highlight the request line, status code, headers, JSON and markup bodies.
- The task list actions column adds "Details" and "Pause/Resume" buttons; the session send key can be configured in system settings (`Enter` / `Cmd+Enter`, etc.), and the web search section adds a proxy input.
- The badge to the right of the session title now shows the LLM config name, with the model ID moved to a hover tooltip; tasks can have an optional name, and the task list adds a name column and search (falling back to the description when the name is empty).
- The skills page adds usage count, last used time and missing dependency stats, making it easier to find skills that are not taking effect or not installed.

#### Changed

- Task titles are now focusable detail links; task assets, company assets, finding task groups and the findings within groups use real server-side pagination, stable sorting and exact totals.
- Adding a company now uses a right-side drawer; scope entry is unified as multi-line text with live recognition, validation and type preview.
- The main Agent input box auto-grows, sends with `Enter`, inserts a newline with `Shift+Enter`, and avoids accidental sends during Chinese IME composition.
- Agent previews, task reports and related details now share a common Markdown renderer; delete confirmations, long errors and mobile drawer widths were fixed across the board.
- The task template selector displays and searches by template name and submits the template ID; the system's original font size was restored, and the app version is shown uniformly as `0.3.3`.
- Task totals and current session tokens highlight only the input, cache read and output values; the send button uses a simpler up-arrow icon.
- The task overview's test scope shows company names instead of IDs.

#### Fixed

- Ordinary text containing dots is no longer mistaken for an ICP filing number.
- Fixed variable catalog entries colliding with global runtime variables (such as `{{.Now}}`), which caused duplicate keys to be rendered in the Agent editor's variable list.

#### Removed

- Removed the standalone "Enter" button from task cards; clicking the task title now opens the details.
- Removed the dashboard "New task" button, the Logo URL field when adding a company, and the finding count badges at the top of the findings page and in task groups.
- Reverted the style that enlarged the global font by 10%, and removed the Worker checkboxes, model icons and per-row token stats from the session list.

### Agent

#### Added

- New tasks can link directly to multiple existing tasks, inheriting live and read-only the goals, facts, findings, completed intents, asset scope and blackboard context of the direct source tasks.
- Blackboard read tools support on-demand queries of source task nodes, facts, findings and execution traces; inherited nodes carry a source marker and all write tools refuse to modify them.
- Company scope tools support domains, URLs, IPs, CIDRs, ICP numbers and company keywords; keywords serve only as scope hints for the Agent and do not participate in automatic asset attribution.
- The finding deep-dive action creates a high-priority manual Worker intent in the original task, with an asset anchor and a `derived_from` edge.
- The overview adds a "Goals" card for manually viewing, adding, editing and deleting goals; adding or editing notifies the Planner and revives the task, while deleting hard-deletes the goal node (cascading to its edges and anchors) without reviving the task.
- The main Agent gets the `steer_work` tool by default, letting it inject course-correction instructions into a running Worker in real time without interrupting it or losing progress (it still verifies that the intent belongs to this task).

#### Changed

- Source task intents do not enter the new task's frontier; the new task keeps its own independent exploration, execution queue, working directory and chat history.
- Deleting a running intent no longer destroys data: the intent is stopped as `stopped`, a deletion reason is required, the reason is attached to the intent as a fact and written into the payload, and the planner perceives it as `cancelled` (keeping the intent content and the reason).
- Main Agent chat is now driven by the server-side activity stream, and input can be recovered after a failed send; opening a session automatically scrolls to the bottom and keeps the last reply visible after the details lazy-load.
- Pausing a task terminates the current Main Agent, Planner and Worker calls, but does not prevent the user from starting new main Agent orchestration sessions while the task is paused.
- Cancellation, shutdown and stream interruption uniformly preserve the real termination reason, generated content, number of turns, duration, tokens and tool calls that never returned.

#### Removed

- Removed the main Agent client's optimistic message echo, avoiding duplicate messages and cross-session stream mixing during pauses, failures or concurrent activity.

### Constraints

#### Added

- Goal decomposition now first extracts operational constraints (allow/deny) before decomposing goals, and the main Agent can add more at runtime; constraints are injected into the Planner and Worker system prompts at the highest priority, and de-biasing diversity and breadth exploration are explicitly subordinate to the constraints.
- The overview adds a "Constraints" card and create/update/delete APIs; constraint injection can be toggled separately for the Planner / Worker (both on by default, read every round, effective immediately). The new table `task_constraints` uses `CREATE TABLE IF NOT EXISTS`, so it is created automatically on old databases.

### Intercept

#### Added

- Command interception adds model fallback approval on top of regex/string rules: when no rule matches, the model makes an `ALLOW`/`ASK`/`DENY` semantic judgment, with a configurable fallback action on failure and action on approval timeout; the interception page is split into two tabs, "Interception rules / Model config", and model verdicts are labeled with a `[model]` prefix and the reason.

#### Fixed

- Hardened parsing of the judge output so that a correct `DENY` verdict is not mistaken for allow.

### Traffic

#### Changed

- Traffic recording now stores whole exchanges in SQLite (large bodies overflow into a hash-deduplicated blob bucket), with a trigram full-text index on text bodies that supports arbitrary substring and Chinese search; deletion becomes a single SQL transaction, dropping from hours to milliseconds, and recording no longer stalls in the meantime. Added streaming download for large bodies and a full-text parameter for `traffic_search`; old file-tree data needs no migration and can still be read, searched and deleted.

### Tasks and assets

#### Added

- Task creation adds an "Asset coverage" toggle (on by default): when off, coverage is not computed or shown, the situation graph shows only assets, `task_scope` is not accumulated automatically, and the related tools are removed from the Planner / main Agent; company linking is unaffected by this toggle.
- Each asset in `insert_assets` gets a new `related` flag (default `true`): it only takes effect when coverage is on; `false` stores the asset only in the shared asset library without counting it toward this task's coverage (e.g. incidentally discovered sibling sites or unrelated assets).
- Company scopes and task test assets uniformly support recognizing domains, URLs, IPs, CIDRs, ICP numbers and keywords from text; domains/IPs can create or reuse global assets, while CIDRs/ICP numbers/keywords are kept as task scope context.

### Build

- `build.sh --release` can build Linux amd64/arm64, macOS amd64/arm64 and Windows amd64 in one go, producing zip release packages that include `skills/`, example configs and the README.
- Uses the Go linker to strip debug info and produce zip release packages; UPX is now explicitly optional, avoiding segfaults at startup of its self-extracting ELF in some Linux environments.
- The Release Workflow runs a startup smoke test on the Linux amd64 binary and ships `SHA256SUMS` with the release packages.

### Contributors

- [@neouks](https://github.com/neouks)

## [0.3.2] - 2026-08-20

### Added

- New tasks can link multiple existing tasks, inheriting live and read-only the facts, findings, completed intents, asset scope and blackboard context of the direct source tasks; the new task still uses its own execution queue, working directory and session history.
- Tasks support an ordered LLM config chain. When provider quota exhaustion is clearly identified, it automatically switches to the next config and persists the current config, exhaustion state and structured audit activity.
- Running and paused tasks support editing the LLM config chain, reordering it and manually switching the current config; automatic switches, manual switches and full-chain exhaustion are surfaced on the task detail page.
- Running Workers can be paused, resumed and cancelled. Pausing keeps blackboard data; cancelling transactionally cleans up the intent and the facts, findings and execution records it directly produced, once the Worker has stopped writing.
- Deleting a task can optionally also clean up associated assets, traffic, findings and task files on disk, with a deletion barrier, concurrency protection and auditable deletion statistics.
- Added an optional task concurrency limit; new tasks beyond the limit queue in FIFO order and start automatically when a run slot frees up.
- Added task asset pagination, company asset pagination, task category statistics and paginated intent Mock contracts.
- Added the `build.sh` single-binary build script, supporting static frontend export, resource embedding, cross-platform targets and build version injection.

### Changed

- Task-level explicit LLM config chains coexist with the existing global LLM Pool; explicit chains keep strict quota-failover semantics, and without an explicit chain the Agent binding and global config rules still apply.
- The main Agent input box supports auto-growing multi-line input, sends with `Enter`, inserts a newline with `Shift+Enter`, and avoids accidental sends during Chinese IME composition.
- The Planner, Workers and the main Agent share a task-level LLM runtime; the task chain uses the smallest context window among its candidate models as the safe compaction threshold.
- The task detail page shows running, idle and paused states based on the real LLM call state; facts, findings, intents, asset references and graph nodes from source tasks are uniformly marked with their source and kept read-only.
- Agent previews, task reports and related detail views now share a common Markdown rendering component.
- LLM model configuration uses cards and drawer interactions, and the model list scrolls independently within the drawer.
- Pausing a task no longer blocks main Agent chat: main Agent orchestration sessions are independent of task pausing, and new messages can still be sent while paused (pausing only terminates the round currently in progress).
- The default wall-clock duration of a single Worker run changed from 600 to 1200 seconds.

### Fixed

- Removed the optimistic echo from the main Agent console in favor of rendering purely from server data, fixing messages getting jumbled or mixed with other sessions' content when pausing or when a send fails.
- Opening a main Agent session scrolls to the bottom by default and fully shows the last reply: after the full content of the last reply lazy-loads and expands, the view automatically sticks to the bottom instead of being pushed off screen.
- Fixed the main Agent session continuing to run after the task was paused, and the main Agent not being stopped when the orchestration Agent paused the task.
- Fixed the task status badge and action button states getting out of sync when a task completed or while the Planner, Workers or main Agent were actually running.
- Fixed possible late blackboard writes or leftover files caused by interactions between Worker cancellation, task deletion and concurrent writes.
- Fixed broken Markdown preview, overflowing long delete-confirmation text, mobile widths and misaligned buttons on some task detail views.
- Added named termination reasons to all Agent cancellation paths; activity details can show who cancelled, the final state, number of turns, duration, token usage and tool calls that never returned.
- Fixed a race during backend shutdown where the parent context could pre-empt and overwrite the named `shutdown` reason, and garbled Chinese activity summaries caused by truncating by bytes.
- Fixed cancellation events with partial streaming output losing the real termination reason, while keeping the content generated before cancellation.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@neouks](https://github.com/neouks)

[Unreleased]: https://github.com/Autumn-27/ARTEX/compare/v0.3.10...HEAD
[0.3.10]: https://github.com/Autumn-27/ARTEX/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/Autumn-27/ARTEX/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/Autumn-27/ARTEX/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/Autumn-27/ARTEX/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/Autumn-27/ARTEX/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/Autumn-27/ARTEX/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/Autumn-27/ARTEX/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Autumn-27/ARTEX/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Autumn-27/ARTEX/compare/v0.3.1...v0.3.2
