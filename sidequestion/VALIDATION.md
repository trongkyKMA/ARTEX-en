# `/btw` validation record

Date: 2026-09-10. Branch: `codex/btw-side-question`. Baseline: `8dae851b9b622f2ff2631f332fde9719d0b16fba`.

An isolated PostgreSQL test database and data directory were used; real model credentials were injected only into the isolated test environment, were not written into code or this record, and the product's default model was not changed. Go 1.26.3, norma v0.3.6, Next.js 16.2.9.

The real model conversations, returned objects, engineering assertions and Qwen's raw review text are saved in [validation-2026-09-10.json](validation-2026-09-10.json) (kept verbatim, in the original language), which contains no API credentials.

## Engineering checks

| Scope | Result | Evidence |
| --- | --- | --- |
| Deep copy of structured messages and tool arguments | Pass | `TestCheckpointDeepCopyAndBoundaries` |
| Summary / compaction requests do not overwrite, complete replies and terminal states are published, half replies excluded | Pass | `TestCheckpointDeepCopyAndBoundaries`, `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| Identity of the actual model pool member | Pass | `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| Tool pairing, 20-pair replay, budget trimming and over-limit errors | Pass | `TestBuildRequestCompactionToolPairingAndBudget` |
| Main and side running in parallel, cancellation isolated both ways | Pass | Blocking Provider, `TestMainSideConcurrencyAndIndependentCancellation` |
| No tool execution, streaming / non-streaming, usage kept on failure | Pass | `TestServiceNoToolsAndUsageOnFailure` |
| Real norma ChatAgent + local Read tool, main transcript / activity isolation | Pass | `TestSideActualChatCheckpointToolResultAndTranscriptIsolation`, streaming and non-streaming subtests |
| Persistence, paging, idempotency, partial answer kept across restart | Pass | `TestSideHistoryIdempotencyPagingAndRecovery` |
| Clear vs late-write races, parent resource deletion, version comparison | Pass | `TestSideClearLateWritersAndDeletedParent` |
| MainAgent / Worker archive and restore, v1/v2/v3 | Pass | `TestSideTaskArchiveVersions` |
| Three parent endpoints, authentication, resource ownership, logical Worker deletion | Pass | `TestSideHTTPGlobalLimitTaskWorkerAndDeletion`, `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| Side questions on a busy main session, independent SSE reconnect / disconnect, cancel, clear | Pass | `TestSideHTTPBusyIsolationClearAndReconnect` |
| Concurrency of 1 per parent session / 4 globally | Pass | Two `TestSideHTTP…` tests |
| Snapshot persisted before submission, follow-up after restart, old sessions cannot forge a snapshot | Pass | `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| Refuse to continue after the cached configuration is deleted or the model changes | Pass | `TestSideRejectsDeletedOrChangedCachedProfile` |
| Before archiving, cancel and wait for the final answer and usage to be persisted | Pass | `TestSideTaskDrainPersistsBeforeArchive` |
| When a streaming consumer cancels early, usage and side-question attribution are recorded only once | Pass | `TestSideUsageRecordedOnceOnConsumerCancellation` |
| Worker / deadline run contexts restored automatically after restart keep publishing new snapshots | Pass | `TestSideRestoredWorkerRuntimePublishesNewCheckpoint` |
| Race check of the related packages | Pass | Commands below |
| TypeScript and production build | Pass | `npx tsc --noEmit`, `npm run build` |
| Biome on the new frontend modules | Pass | `biome check`, 3 new modules |

With `ARTEX_PG_DSN` configured to a separate disposable database, the automated checks can be reproduced (do not point it at a production database):

```sh
go test -race ./agent ./db ./server ./sidequestion ./llmrec ./llmpool \
  -run 'Test(Side|Checkpoint|Snapshot|BuildRequest|Service|MainSide|CaptureRun|TaskArchive|CompleteForwards|StopIntent|CancelIntent)' -count=1
cd web
npx tsc --noEmit
npx biome check src/lib/side-questions.ts src/hooks/use-side-questions.ts src/components/side-question-workspace.tsx
npm run build
```

The full Go regression is not all green: two existing tests in the `server` package fail during temporary-directory cleanup, both reporting `TempDir RemoveAll … directory not empty`:

- `TestInheritedActivityDetailAndRelationDeletion`
- `TestTaskMetadataPatchReturnsRenameAndPin`

After exporting the source from the unmodified baseline above and rerunning the `server` package in the same isolated environment, these two cleanup failures also reproduce. The baseline run additionally showed a target-node count assertion failure in `TestCoreTaskLifecyclePG`; the final modified `server` regression does not have that assertion failure. Other packages pass, and the side-question tests and race checks of this change pass. Baseline problems were not marked as passing for this acceptance, and no existing assertion was changed to hide a problem.

The Next.js build prints the existing multiple-lockfile / workspace-root inference warning; the build completes and all pages are generated.

## Browser checks

Using the Codex In-app Browser connected to an isolated local Go service and a Next.js dev server, the following manual-automation steps were completed on desktop and on a 390 x 844 narrow screen, checking screenshots and browser logs:

- Typing `/btw` while an ordinary chat is running shows the main content and the side question together; the desktop side panel works.
- Consecutive follow-ups; after a side question is stopped, the generated part is kept; the main flow continues.
- The request continues when the panel is closed, and the completed answer is restored on reopening; after refreshing the page, an empty `/btw` restores the history.
- Input, buttons, history and close in the narrow-screen Drawer work, with no horizontal overflow.
- Clear uses a confirmation dialog; after clearing, the history disappears while the main transcript and snapshot are kept.
- The task MainAgent and two Workers each asked questions and were switched between; Agent labels and histories did not cross over.
- A blocking local model fixture kept a Worker running; `/btw` was submitted from the Worker's main input box, and after stopping the side question the Worker still showed live running and its own pause button, while the side question kept its partial answer.
- The browser error / warning log is empty.

The controllable fixture is used to verify concurrency timing precisely, independent of a real model's output speed. During debugging, two Worker runtime checks did not form a valid concurrency window (task already finished / answer finished early); after fixing the fixture they were redone and passed; those initial runs are not counted as valid passes.

## Real model conversations

`grok-4.6` was probed first, via the OpenAI-compatible endpoint `http://127.0.0.1:12580/tingly/openai`. The probe returned HTTP 200 with model name `grok-4.6` and `READY`, in 2.82 seconds. The first choice was available, so the Tingly `glm` or Zhipu `glm-5.3` fallback chain was not used; these two fallback services were not verified this time.

| Scenario | Actual result |
| --- | --- |
| Asking about the asset, goal and marker while the main session runs | Returned `redhaze.top`, reading and summarizing the home page as the goal, and `BTW-REAL-0910`; side question completed in 16.97 seconds |
| Asking for the tool evidence after the main session finished reading the home page | Correctly cited WebFetch 200, curl redirects 301 -> 302 -> 200, and the page title; 7.24 seconds |
| Side question asking Bash to create a test file | Refused to execute, the target file was not created; 7.74 seconds |
| A completed side question does not change the main context | The main transcript SHA-256 and main activity records stayed the same; side-question tool executions were 0 |
| Follow-up after really stopping / restarting the Go service | Kept the 3 earlier side-question history entries and answered the asset, marker and title directly from the persisted snapshot without rerunning the main Agent |
| New session with a non-streaming Grok configuration | Correctly answered the asset and `ATOMIC-0910`; usage returned and saved: input 11734, output 138, cache_read 11520 |

In the asset case the main session used WebFetch and Bash/curl to read the public home page; the landing page is `https://id.redhaze.top/home`, titled "红幕科技 RedHaze Group · 全球综合集团门户". Bash staged the response in a local test file; nothing was written to the remote side. This fact was verified separately from "the side question executed no tools".

Main transcript checksum: `e7e61f135a4a120954b539f357e8c4205d7d5cd7460dcaf3dc0fd066463e1d00`.

**Usage limitation:** Tingly's Grok streaming responses return no usage. A separate direct request with `stream_options.include_usage=true` returned HTTP 200, 12 data frames and 0 usage frames. So the 0 in the streaming test means the endpoint provided no usage and cannot be read as no billing. Non-streaming usage and the fixture's failure / cancellation usage are all saved correctly.

## Qwen review

Review model `qwen-flash`, OpenAI-compatible endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`, HTTP 200. It was given the first three real side-question conversations, the main session's tool evidence and the engineering assertions; it returned `verdict: accept`, `concerns: []`, judging the answers consistent with the asset, marker and page-read evidence, and the side question's tool refusal consistent with the constraints. Review usage: prompt 6625, completion 312, total 6937.

This Qwen review did not cover the later service restart and non-streaming tests. Qwen's summary of "no writes" is too broad: the main session's curl did create a local temporary response file, as recorded above. Concurrency, zero tool executions and transcript isolation are judged by engineering assertions; the model review only helps assess answer quality.
