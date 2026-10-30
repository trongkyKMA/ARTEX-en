# Multi-traffic evidence for findings

English · [中文](漏洞流量证据.md)

The **Linked traffic** section of a finding's details supports multi-select across pages, a role and a note per item, ordering, and unbinding. The traffic page can also multi-select records and link them to an existing finding in one go. Finding evidence inherited by a task is read-only; to change it, go to the source task.

The **Agent auto-binds traffic** option in system settings is off by default; it is read and written through `agent_traffic_binding` on `/api/settings`. Turning it on increases token usage from reviewing requests/responses, tool calls and prompts; the next agent round picks up the new setting. When it is off, the auto-bind parameters and the late-binding tool are hidden, no auto-binding guidance is injected, and new auto-bind submissions from already-running sessions are rejected. Manual binding, traffic capture, reading saved evidence and exporting are not affected.

When it is on, the default flow is "finding recorded → reporting agent triggered automatically → traffic verified and bound → report written against the latest evidence version". The reporter keeps the verification command, key output, any real traffic IDs and their roles in `evidence`; the reporting agent combines the finding details and the execution record, verifies with `traffic_search` / `traffic_get`, calls `bind_finding_traffic`, then reads the latest `version` and saves the report. When the option is off, the reporting agent gets no extra raw-traffic search/read tools and does not auto-bind; it can still read manually bound snapshots and write the report.

Compatible with existing callers: `traffic_refs` / `evidence_hint_id` on `report_finding` can still bind explicitly and immediately. Binding is optional: for non-HTTP findings such as TCP, or when nothing was captured or the exact record can't be found, omitting references still lets you report and write the report normally; keep other verifiable evidence such as command output and logs, and preferably explain why nothing is bound — no new required fields are added. All submitted IDs must be valid and their bodies complete. If any one fails, the whole binding operation is rolled back; if an explicit bind submitted with a report fails, the entire report is rolled back. Appending the same snapshot again adds no binding and does not overwrite its note.

## Agent IDs and report versions

`report_finding` gains an optional parameter; the array order is the initial evidence order:

```json
{
  "traffic_refs": [
    {"traffic_id": "real traffic ID", "role": "baseline", "note": "normal account request"},
    {"traffic_id": "another real traffic ID", "role": "proof", "note": "reproduction request"}
  ]
}
```

Roles are `baseline` (normal control), `proof` (proves the vulnerability), `verification` (additional verification) and `supporting` (supporting evidence, the default). Check the real records with `traffic_search` / `traffic_get` first; domain and time are only used to filter candidates and do not imply which task a record belongs to.

The prompt is based on [CyberStrikeAI's vulnerability reporting tool guidance](https://github.com/RuoJi6/CyberStrikeAI/blob/54d56774b8bd285817d16d48b70a4a5e6e0963f7/internal/app/vulnerability_tools.go), combined with this project's optional-binding convention, without adding a mandatory "reason for no capture" check. IDs must never be guessed, and probing again just to obtain a capture should be avoided.

The first line of the result is still `finding recorded: <exploration node ID>`; it is followed by JSON with the standalone finding record `finding_id`, the exploration node `finding_node_id`, and a binding summary.

- `get_finding_traffic(finding_id)` takes the **standalone finding record ID** and returns the ordered list and `version`; pass `binding_id`, `side=request|response`, `offset`, `length` to read in segments of up to 8192 bytes each.
- `finding_id` in `update_finding_report` **still takes the exploration node ID**. The new `evidence_version` is the version actually read; if the evidence changes while the report is being generated, writes based on the old version are rejected and the report must be re-read and regenerated.
- Legacy report calls without a version don't claim to cover the existing traffic evidence. After bindings, notes, roles or order change, an existing report is marked as needing an update.

With auto-binding on, `add_hint` / `add_task_hint` can store `traffic_refs` on a single hint or on each element of a batch `hints`. When the planner reports on someone's behalf it can pass `evidence_hint_id` to explicitly pick the references from the corresponding hint in this task; inherited hints can't be referenced. The system never guesses bindings from domain, time or browsing history. A failed submission creates no partial finding and does not trigger the report early.

If an existing finding is missing bindings, add them later with `bind_finding_traffic(finding_id, traffic_refs)` — no need to record it again. `list_findings` / `list_task_findings` / `node_detail` / `get_task_node_detail` return explicit `finding_id` and `finding_node_id`; the old `id` keeps its exploration-node meaning.

On startup, only optional properties are added to legacy tool schemas, the default raw-traffic tool bindings are extended to the reporting agent, and the late-binding tool is given to the reporting agent by default. Custom binding lists, prompts, descriptions and enabled states are preserved. The guidance is added after the final tool assembly: the reporting role hands over existing evidence, and the reporting agent verifies, binds and writes the report. When a platform chat lacks task context, it should hand over to the task agent through a structured hint rather than report directly. Existing evidence should be handed over before a task is judged complete; nothing waits for a capture that doesn't exist. A failed `report_finding` does not trigger the reporting agent.

## API

Base path: `/api/exploration/findings/{finding_id}/traffic`, using the standalone finding ID. Standard authentication applies; `context_task` checks task visibility and inherited read-only status.

| Method / relative path | Request / response |
| --- | --- |
| `GET` | Ordered summary, evidence version, version used by the report |
| `POST` | `{"traffic_refs":[...]}` appended as one batch |
| `PATCH /{binding_id}` | `{"version":1,"role":"proof","note":"note"}` |
| `DELETE /{binding_id}` | `{"version":1}` |
| `PUT /order` | `{"version":1,"binding_ids":["2","1"]}`, must be the complete list |
| `GET /{binding_id}` | Snapshot metadata and a bounded body preview |
| `GET /{binding_id}/body` | `side`, `offset`, `length`; `download=1` downloads the full original bytes |

Version/order set conflicts and writes during archiving return `409`; writes to inherited evidence return `403`; a binding that doesn't exist or doesn't belong to the finding returns `404`; traffic/attachment read and verification failures return an explicit error.

## Storage and migration

PostgreSQL is migrated idempotently on startup: new tables `traffic_evidence_snapshots` and `finding_traffic_bindings`, plus `findings.evidence_version` / `report_evidence_version` (default 0). No bindings are back-filled by guessing from historical text.

A snapshot stores the original traffic ID, capture time, URL, method, status, request/response headers, body lengths and SHA-256. Bodies are stored by hash under `<data>/evidence/blobs/<first two chars>/<hash>.bin`, separate from the purgeable `data/traffic`, so several findings can share a snapshot/body. Snapshots have no content-update API; if verification fails, reading and exporting fail.

The full body is read under the original traffic write lock, including large body blobs and legacy directory records. Files are persisted and verified first, then the exploration node, intent relations, finding, snapshots and bindings are written in a single PostgreSQL transaction; the planner is only notified after commit. A failure may leave unreferenced files behind, but never partial business records.

PostgreSQL advisory lock `7337741004` coordinates evidence files and SQL references; the task row lock forbids evidence changes once archiving is queued. Restore holds the evidence lock from body installation through metadata commit. Deleting a finding cascades to its bindings.

The cleaner runs hourly and only reclaims content that is unreferenced and not part of an in-flight operation, with a delay of at least 24 hours. Regular traffic cleanup does not touch the evidence directory. When backing up hot data, back up PostgreSQL and `data/evidence` together.

## Export and archive

Markdown includes the ordered evidence list and version; JSON includes the metadata; CSV adds the count and binding IDs. `md-zip` keeps the finding Markdown and adds:

```text
evidence/<finding_id>/<binding_id>/
  manifest.json
  request.http
  response.http
  request.bin
  response.bin
```

The Markdown references the messages through relative links. Before the download is sent, attachment copying, hash verification, compression, disk sync and a CRC read-back check of every ZIP entry are completed; anything missing or corrupt fails the whole download. Full attachments keep the original binary bytes.

Archive v3 collects snapshots and bodies through the finding bindings, independent of the original traffic or domains. Hot data is only cleaned after the package is verified; shared evidence is kept. Restore verifies and installs bodies first, then restores metadata and bindings in a transaction, and can be retried after a failure. v1/v2 archives remain restorable, with missing new fields explicitly set to 0.

## Verification and limits

Give each test package its own freshly created PostgreSQL test database, set through `ARTEX_PG_DSN`, so leftover task/model fixtures can't trigger background runs. Run the full tests of the affected packages and make sure nothing is skipped because of missing configuration:

```sh
# Before each package, set ARTEX_PG_DSN to that package's own test database; an explicit configuration failure must error out.
go test ./<package> -count=1
go test -race -p 1 ./evidence ./db ./agent ./server -run 'TestEvidence|TestFindingTraffic|TestFindingEvidence|TestReportFindingAtomicContract|TestTaskArchive'
```

Frontend verification includes `npx tsc --noEmit`, Biome checks on the affected files, a Webpack build and a `NEXT_EXPORT=1` static export. Use a separate cache directory so a running dev server isn't overwritten.

Local end-to-end acceptance uses separate ports, controlled HTTP / domain HTTPS targets and a temporary data directory, and covers both binding entry points, cross-page selection, ordering/notes, error messages, inherited read-only, downloads, and — after deleting the original traffic — export, archive, reclaiming hot bodies, restore and hash verification.

The first version uses a global evidence coordination lock; during large batch binds/exports or slow attachment downloads, other evidence operations may wait. Evidence cannot be fabricated when the recording or full body is missing. This feature does not change the capture switch, and does not deal with certificate issues for HTTPS requests made directly to an IP.
