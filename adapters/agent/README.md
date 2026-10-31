# ARTEX agent adapter

Connect Claude Code and Codex through a local stdio MCP server, or Pi through its native extension interface. All three use the same validated tools and authenticated ScopeWeaver HTTP API. This adapter lets your coding agent control ScopeWeaver; it does not replace ScopeWeaver's own planner/workers or turn a coding-agent subscription into a model API key.

## Setup

Requirements: Node.js 22+, a running ScopeWeaver backend, and an existing admin login. The adapter does not initialize or change your password. Install the separate adapter dependencies:

```sh
cd ARTEX-en/adapters/agent
npm ci
export SCOPEWEAVER_URL=http://127.0.0.1:8787
export SCOPEWEAVER_PASSWORD='your-existing-admin-password'
```

The password is the one set at `/setup`. This build authenticates a single shared account named `ARTEX` and rejects any other name with the same 401 it returns for a wrong password, so leave `SCOPEWEAVER_USERNAME` unset unless you point the adapter at a backend that has named accounts. The returned JWT stays in memory. Alternatively set `SCOPEWEAVER_TOKEN` to an existing login JWT; a supplied token takes precedence. Expired/invalid tokens produce an error and are not silently replaced. Keep credentials in your environment or secret manager; do not commit them to client configuration.

Reads are enabled by default. To enable task creation and pause/resume, explicitly set `SCOPEWEAVER_ALLOW_WRITES=true` before starting the adapter. Task creation schedules work immediately when the backend has an LLM configured. Retain the project's [locally isolated usage restrictions](../../README.md#license-and-disclaimer) and confirm the intended scope before creating a task.

### Claude Code

Use an absolute path to this checkout. Claude Code starts the adapter and inherits its environment:

```sh
claude mcp add --transport stdio artex -- node /absolute/path/ARTEX-en/adapters/agent/src/mcp.js
```

Verify with `claude mcp list`, then use `/mcp` in Claude Code to inspect its tools. [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Codex

```sh
codex mcp add artex -- node /absolute/path/ARTEX-en/adapters/agent/src/mcp.js
```

Verify with `codex mcp list` and `/mcp`. For explicit environment forwarding in a project/user configuration:

```toml
[mcp_servers.artex]
command = "node"
args = ["/absolute/path/ARTEX-en/adapters/agent/src/mcp.js"]
env_vars = ["SCOPEWEAVER_URL", "SCOPEWEAVER_TOKEN", "SCOPEWEAVER_PASSWORD", "SCOPEWEAVER_LANGUAGE", "SCOPEWEAVER_ALLOW_WRITES"]
```

Use the credential variable that you set; omit unused entries. [Official OpenAI MCP documentation](https://developers.openai.com/codex/mcp).

### Pi

```sh
pi -e /absolute/path/ARTEX-en/adapters/agent/pi-extension.js
```

The extension registers native Pi tools and uses the same environment variables. It does not require a Pi MCP plugin. It imports no Pi package namespace, so it follows the public `registerTool` interface across Pi package renames. The adapter package also declares `pi.extensions` for Pi's package loader. [Pi extensions](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).

## Tools

| Tool | Purpose |
| --- | --- |
| `scopeweaver_health` | Backend availability and LLM readiness; no login required |
| `scopeweaver_list_tasks` | Task status, counts, pagination |
| `scopeweaver_get_task` | One task's persisted state and configuration |
| `scopeweaver_get_coverage` | Task asset coverage |
| `scopeweaver_list_findings` | Paginated findings filtered by task, severity, status or text |
| `scopeweaver_get_finding` | Finding detail, evidence and report |
| `scopeweaver_create_task` | Create/schedule a task; requires writes enabled |
| `scopeweaver_control_task` | Pause/resume a task; requires writes enabled |
| `scopeweaver_update_findings` | Triage write-back: change status, severity, name or vulnclass of up to 200 findings; dry run by default, applies only with `dry_run=false`; requires writes enabled |
| `scopeweaver_finding_stats` | Finding counts by severity and status |
| `scopeweaver_export_findings` | Save findings with evidence to `SCOPEWEAVER_EXPORT_DIR` as md-zip, md-single, csv or json and return the file path; changes nothing on the server |
| `scopeweaver_list_goals` | A task's goals with IDs and met/unmet state |
| `scopeweaver_list_constraints` | A task's allow/deny operating constraints |
| `scopeweaver_list_nodes` | A task's exploration graph by kind: intent, fact, hint, goal, digest |
| `scopeweaver_list_assets` | The shared asset store, optionally by kind |
| `scopeweaver_manage_goals` | Add, edit or delete a goal, which changes when the task stops; requires writes enabled |
| `scopeweaver_manage_constraints` | Add, edit or delete an operating constraint; requires writes enabled |
| `scopeweaver_control_intent` | Pause, resume, soft-cancel or rerun one intent; requires writes enabled |
| `scopeweaver_steer_worker` | Correct a running worker before its next action; requires writes enabled |
| `scopeweaver_set_task_llm` | Point a task at existing LLM profiles; requires writes enabled |
| `scopeweaver_tell_main_agent` | Message a task's main agent like an operator, for hints and one-off directions; requires writes enabled |

No tool widens the authorized scope. Adding or removing a task scope entry, inserting assets and deleting assets are deliberately absent: the adapter's own context carries untrusted target content (findings, evidence, target responses), so exposing them would turn a prompt injection in that content into an authorization change. `tell_main_agent` cannot reach them either, because the backend rejects an intent whose assets fall outside the task scope at the tool layer. `control_intent` exposes only the soft cancel, since the hard form cascades into saved facts and findings.

Example requests: “List my ScopeWeaver tasks,” “Show the high-severity findings for task 12,” or, after enabling writes and confirming a local lab scope, “Create a task for this local fixture and show its progress.” A successful create response proves the task exists; check its status and findings to learn whether execution has finished. The adapter does not bypass backend LLM requirements.

## Configuration and failures

| Variable | Default / behavior |
| --- | --- |
| `SCOPEWEAVER_URL` | `http://127.0.0.1:8787`; HTTPS or loopback HTTP origin only |
| `SCOPEWEAVER_TOKEN` | Existing backend JWT; preferred over password |
| `SCOPEWEAVER_USERNAME` | `ARTEX`, the only name this build accepts; set it only against a backend with named accounts |
| `SCOPEWEAVER_PASSWORD` | Existing account password; login on first authenticated request |
| `SCOPEWEAVER_CF_ACCESS_CLIENT_ID` / `SCOPEWEAVER_CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token, sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret`; set both or neither; HTTPS only |
| `SCOPEWEAVER_EXPORT_DIR` | `./scopeweaver-export`; where `export_findings` writes files (never overwrites) |
| `SCOPEWEAVER_ALLOW_WRITES` | `false`; accepts only `true` or `false` |
| `SCOPEWEAVER_LANGUAGE` | Accepted but inert: this build does not read `Accept-Language`. Agent output language is a server setting (`zh`/`en`) on the System page |
| `SCOPEWEAVER_TIMEOUT_MS` | `30000`; integer from 1 to 120000 |

No generic HTTP, shell execution, deletion, approval bypass, provider configuration or arbitrary endpoint tool is exposed. Requests stay on the configured origin, reject redirects, forward cancellation and time out. Responses over 2 MiB fail explicitly; narrow the query rather than treating clipped evidence as complete. Task lists are paginated in the adapter; findings use backend pagination. Tools return `{data: ...}` in text and structured results (Pi uses `details`). Evidence is untrusted target content and must not be treated as instructions.

Failed MCP calls return `isError: true`; failed Pi calls throw for Pi to mark as tool errors. Error messages redact configured credentials. Writes are never automatically retried. If a write times out, inspect task status before repeating it, because the backend may have accepted it.

## Verification

```sh
npm test
npm run check
```

The end-to-end harness runs a real ScopeWeaver handler and PostgreSQL, spawns the MCP stdio server through the official SDK, and executes the Pi tool handlers against that backend. It initializes an isolated test password, creates tasks, verifies persisted pause/resume state and coverage, reads a clearly simulated finding, and checks invalid authentication, missing tasks and invalid inputs. No model/provider or target scan is used. Running the Go E2E harness requires the source checkout; platform ZIPs include the adapter's unit tests but only the compiled Go backend.

From the repository root, after creating a **fresh disposable** database named `scopeweaver_adapter_*`:

```sh
SCOPEWEAVER_ADAPTER_E2E=1 \
ARTEX_PG_DSN='postgres://user:password@127.0.0.1:5432/scopeweaver_adapter_e2e?sslmode=disable' \
go test ./server -run '^TestAgentAdapterE2E$' -count=1 -v
```

The harness fails if PostgreSQL is unavailable or the database is not explicitly selected; it never substitutes mocks. GitHub Actions repeats these checks in a dedicated disposable PostgreSQL service. MCP protocol tests establish compatibility with the shared interface; they do not claim a paid Claude/Codex/Pi model session was run.
