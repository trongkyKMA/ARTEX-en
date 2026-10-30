---
name: api-recon
description: Invoke this skill when collecting a website's API endpoints.
---

# API Recon (Frontend API Reconnaissance)

Under **authorized** conditions, discover as completely as possible: **backend APIs** (path, method, parameters, response body), **frontend routes**, and **UI feature trigger points** (tabs, modals, table actions, etc.).

---

## Boundaries and Prohibitions (Agent Must Read · Violation Means Out of Bounds)

This skill **only does API / parameter-surface reconnaissance**; it is not the vulnerability-hunting or exploitation phase.

### Task Boundaries

| Area | Allowed | Forbidden |
|---|---|---|
| **Goal** | Enumerate paths, methods, parameters, routes, UI trigger points | SQLi/XSS/privilege-escalation/brute-force/fuzzing for vulnerabilities, request-tampering attacks, destructive operations |
| **Auth** | Hook + stub/mock to bypass the **client-side** login gate | Asking the user for or guessing usernames/passwords; attempting real login form submissions |
| **Runtime** | Without credentials, hook APIs and use mock responses to get the SPA into its post-login shell | Flows that can only continue with a real backend session |

### Credential-less Dynamic Analysis (Phase 3 default)

1. Use `preload.js` / `runtime_harvest.js` to **intercept and stub** bootstrap APIs such as login, permissions and menus;
2. For business query APIs, return a mock body that is **structurally correct, with a success business code, and data that may be empty**;
3. Make the frontend render post-login pages even with no backend or in a 401 environment, thereby triggering more XHR/fetch/WebSocket requests;
4. **Empty data, blank tables and placeholder UI are all expected**—do not switch to real login or vulnerability testing because of them.

**In one sentence**: use mocks to open up frontend routes and component mounting, and **record only outbound requests**; what the backend returns does not matter, what matters is **which further APIs** the frontend sends.

### Hard Process Prohibitions

| Forbidden | Do instead |
|---|---|
| grep/curl/Read the main entry `index-*.js` to extract API paths before Phase 1 is complete | Run `OUTDIR/harvest_static.py` |
| Hand-writing `extract_apis.py` or similar scripts to replace harvest | Modify `OUTDIR/harvest_static.py` and rerun |
| Repeating the same grep/command after it has failed ≥2 times | Change strategy: read tool_logs, modify harvest, check reference |
| Skipping Gate A/B and running the original `scripts/` directly | Copy to OUTDIR and modify for the target |
| Real username/password, OTP, OAuth or other authentication | stub/mock (see above) |
| Skipping stubs on the grounds of "getting real data" to do privilege-escalation/injection testing | Record only outbound; that is the recon boundary |
| Irreversible operations such as deleting, exporting sensitive data, bulk writes | Same applies to coverage clicks |
| Claiming all pages and APIs have been obtained without completing runtime + dynamic enumeration | See "Definition of Done" or note the limitations |
| Claiming all parameters are known without completing the parameter trigger matrix + diff | Phase 3b matrix + Phase 5 diff |
| Inferring required/optional from a single runtime sample | Multi-sample diff or inference from validation rules/errors |

---

## Two-Layer Model + Run Modes

| Layer | Output | Limit |
|---|---|---|
| **Static** (JS bundle) | Full endpoint paths, draft routes, field candidates at payload-assembly points | No HTTP methods; parameters require Phase 1b; misses URLs concatenated at runtime |
| **Runtime** (live session) | Method + body + response + dynamic URLs + WS/SSE; multi-sample diff completes parameters | Pages must actually render to send requests; a single sample is not enough to decide required/optional |

| Run mode | Engine | Use for |
|---|---|---|
| **depth** | `runtime_harvest.js` (Puppeteer) | API inventory, METHOD/params/response body, WS/SSE, reproducible batch runs |
| **coverage** | browser + `preload.js` | Clicking tabs/modals/tables, deeper feature coverage |
| **both** | depth first, then coverage | Most complete, takes longest |

**Parameter methodology** (no generic script): paths via harvest/regex; parameters via **anchor window expansion + UI binding chain + multi-sample diff + inference from errors** (grep recipes in section J of [reference.md](reference.md)).

---

## Definition of Done

All must be satisfied before claiming recon is complete:

- [ ] **Static**: Phase 1 harvest produced `api_static.txt`, `routes.txt`, `js/`
- [ ] **Runtime**: at least one of depth or coverage; coverage/both require **hooks in effect + dynamic enumeration loop**
- [ ] **Into the shell**: visiting business paths does not land on `/login` (watch out for hash routing)
- [ ] **Parameters**: coverage/both completed the parameter trigger matrix + `param_samples.json`; Phase 5 merged `params_merged.json`
- [ ] **Depth** (if module pages are blank): Phase 4 permission tree reconstructed and rerun until **module-level APIs** appear (not just locale/bootstrap)
- [ ] **Delivery**: Phase 5 outputs complete (see the Phase 5 output table); `insert_assets` has written service and endpoint assets

---

## Scripts and Gates

`scripts/` contains reference templates only; it is **forbidden** to run the originals directly and treat that as the final result.

**Rule**: read first → modify for the target → write into `OUTDIR` (e.g. `recon/`) → record in `CHANGES.md`; if they don't fit, rewrite following the methodology and borrow only the structure.

| Gate | When | Reference script → OUTDIR copy | Common required changes |
|---|---|---|---|
| **A (static)** | After Phase 0, before the **first** harvest/spider run | `harvest_static.py` / `spider_mpa.py` | **For most sites the default regex runs as is**; only when the manifest/dialect doesn't match, change the endpoint regex, webpack/Vite `publicPath`, MPA exclude/cookie |
| **B (runtime)** | After Phase 2, before running depth/coverage | `runtime_harvest.js` / `preload.js` + `config.json` | Cookie/localStorage keys, neutralize success values, stubs, login regex, API prefix, hash/history |

**Mandatory SPA order** (not interchangeable; Phase numbering takes precedence over "explore first, script later"):

| Step | Must | Forbidden |
|---|---|---|
| After Phase 0 is complete | Next Bash = `python3 OUTDIR/harvest_static.py <URL> OUTDIR` | curl/grep/Read the main entry `index-*.js` (usually >500KB) |
| Gate A | Copy script → small changes as needed → **run immediately** | Extracting APIs by hand first and then deciding whether to harvest |
| Before Phase 1 is complete | Check outputs with `wc -l`; on 404 modify harvest and retry | Hand-written extract scripts; repeatedly grepping URLs that were not downloaded |
| From Phase 1b on | grep only `OUTDIR/js/*.js` | Using the main bundle instead of harvest |

- ✅ Copy `harvest_static.py` → (optional) modify regex → **run immediately**
- ❌ curl main bundle → grep many times → write a temporary extract → harvest only at the end
- **MPA**: after Phase 0, next Bash = `python3 OUTDIR/spider_mpa.py ...`

---

## Tool and Output Constraints

| Constraint | Description |
|---|---|
| Large files | `index-*.js` >100KB **must not** be Read/grepped into context; batch-process with OUTDIR scripts |
| grep output | Must use `\| head -20` or `-m 5`; keep only path summaries in the conversation, do not paste bundle fragments |
| Checks | Use `wc -l`, `ls \| wc -l`; do not Read whole directories |
| Initial regex probe | Optional, ≤1 time, only on small chunks ≤50KB or HTML; the formal static pass is harvest |
| reference | Recipes/templates/troubleshooting are in [reference.md](reference.md); do not repeat the full text inline |

---

## Execution Roadmap

```
Phase 0 Classification + OUTDIR
  → Gate A → Phase 1 harvest (★ run immediately ★)
  → Phase 1b parameter reverse engineering
  → Phase 2 three auth gates → config.json
  → Gate B → Phase 3 runtime + parameter matrix
  → Phase 4 permission tree (if needed) → rerun Phase 3
  → Phase 5 merged report + insert_assets to bulk-insert all discovered service and endpoint API assets; under no circumstances may any discovered asset be left out when inserting
```

Check off in order; **do not enter the next Phase until the previous item is complete**.

1. [ ] **Phase 0**: initial probe for SPA/MPA; create `OUTDIR` → [Phase 0](#phase-0--classification)
2. [ ] **Gate A + Phase 1**: copy script → harvest **immediately** → check with `wc -l` → [Phase 1](#phase-1--static)
3. [ ] **Phase 1b**: anchor window expansion + binding layer → `param_candidates.json` → [Phase 1b](#phase-1b--parameter-reverse-engineering)
4. [ ] **Phase 2**: three auth gates → `config.json` → [Phase 2](#phase-2--three-auth-gates)
5. [ ] **Gate B**: adjust runtime scripts → [Phase 3](#phase-3--runtime)
6. [ ] **Phase 3**: depth / coverage / both; confirm into the shell; parameter trigger matrix → `param_samples.json`
7. [ ] **Phase 4** (if needed): permission tree → patch stubs → rerun Phase 3 → [Phase 4](#phase-4--permission-tree-reconstruction)
8. [ ] **Phase 5**: merged outputs + report + `insert_assets` → [Phase 5](#phase-5--merge-and-report)

---

## Phase 0 — Classification

Fetch the entry HTML and **create `OUTDIR`** (do not modify the skill's own `scripts/`):

- **SPA**: empty shell + `<div id=app>` + chunks → Phase 1–5
- **MPA**: SSR + `<form>`, no endpoint bundle → after Gate A:

```bash
python3 recon/spider_mpa.py <BASE_URL> <OUTDIR> [--cookie "session=..."] [--max 300] [--depth 5] [--exclude "logout|delete|destroy"]
```

Outputs `forms.txt`, `links.txt`, `api_inline.txt`. If it is an SPA and forms ≈ 0 → switch to Phase 1.

---

## Phase 1 — Static

Follow [Scripts and Gates](#scripts-and-gates) · [Tool and Output Constraints](#tool-and-output-constraints).

```bash
python3 recon/harvest_static.py <BASE_URL> <OUTDIR>
```

harvest: parse HTML scripts → webpack/Vite manifest → download all lazy chunks → output `js/`, `api_static.txt`, `routes.txt`, `chunkmap.txt`.

```bash
wc -l OUTDIR/api_static.txt OUTDIR/routes.txt
ls OUTDIR/js | wc -l
```

- Chunk count vs manifest: on 404, modify harvest and retry; do not curl chunks one by one by hand
- `api_static.txt` too small → loosen the endpoint regex inside OUTDIR and rerun (see reference)

### Phase 1b — Parameter Reverse Engineering

Paths come from Phase 1; parameter fields need separate recon. grep rules: see [Tool and Output Constraints](#tool-and-output-constraints).

**Completion criterion**: for important APIs you can answer—field names, transport location, inferred type, whether required, sample values, confidence.

#### 1b.0 — Transport Form

| Form | Where the parameters are | Look at statically first |
|---|---|---|
| REST JSON | body + query | `(params\|data\|body)\s*:\s*\{` next to the path anchor |
| GraphQL | `variables` | gql templates, `$page: Int` |
| Traditional form | urlencoded | `<form>`, `FormData` |
| File upload | multipart | `FormData.append` |
| Path parameters | `/user/:id` | Route table + `useParams` / `$route.params` |
| Encryption/signing | Wrapped into `sign`/`data` | Hook the encryption function's input arguments (reference section D) |

Output: annotate each API with `transport: query|json|form|graphql|encrypted`.

#### 1b.1 — Anchor Window Expansion

Use a known path as the anchor and widen the window to find the payload-assembly object:

```bash
grep -n '"/api/user/list"' OUTDIR/js/*.js | head -20
grep -rhoaE '.{0,120}("/api[^"]+").{0,200}' OUTDIR/js/*.js | head -20
grep -rhoaE '(params|data|body|payload)\s*:\s*\{' OUTDIR/js/*.js | head -20
```

| Wrapper layer | Parameter clues |
|---|---|
| axios instance | `data` / `params` |
| Unified request | Interceptors inject global fields |
| OpenAPI client | Generated method signatures |
| React Query / SWR | Second argument of the hook |
| Vue composable | Composable input arguments |

Type remnants: `yup`/`zod`/rules, `Form.Item name=`, embedded Swagger.

→ `param_candidates.json`: `{ path, fields[], source: "static-callsite", confidence }`

#### 1b.2 — Binding Layer

```
Form field → onFinish/handleSubmit → transform → API payload
```

| Binding source | Technique |
|---|---|
| Form submit | Follow submit → transform → API |
| Table search | `getFieldsValue()` → `params` |
| Route | `:id` / `?tab=` |
| Interceptor | Global `tenantId`, pagination, sign |
| Enum select | `options` → API enum values |

Use the DevTools call stack to trace upward from `fetch`/`XHR.send` to the payload-assembly function.

#### 1b.3 — Three Payload-Assembly Questions (≠ Phase 2 three auth gates)

| Question | What to answer |
|---|---|
| **Assembly** | Where the payload is built, traces of transforms |
| **Validation** | required, pattern, enum |
| **Transport** | path / query / body / multipart / header |

The interceptor gate (Phase 2) also reads globally injected fields along the way (Authorization, `X-Tenant-Id`, sign).

#### 1b.4 — Hand-off to Phase 3

Candidate fields come from the static/binding layer; **required/optional/conditional dependencies** require the Phase 3 parameter matrix + diff + Phase 5 inference from errors.

---

## Phase 2 — Three Auth Gates

grep in `OUTDIR/js/` (with `head`) and write into `config.json` (recipes in reference):

| Gate | Question | Keywords |
|---|---|---|
| **Render gate** | How is "logged in" determined? | `isLogin`, `getToken`, Cookie/localStorage |
| **Interceptor gate** | What triggers a redirect to `/login`? | `response_code`, `errno`, axios interceptor |
| **Content gate** | Where do menus/permissions come from? | `menu`, `permission`, `role`, `acl`, `routes` |

Do not treat localStorage key names as credentials—they must be confirmed from chunks/the request chain.

**Exit = Gate B**: put the conclusions into `config.json`, and modify `OUTDIR/runtime_harvest.js` / `preload.js`.

### Phase 2b — API Observation (optional)

Use `preload.js` inside OUTDIR to confirm session key names, Authorization, nested API URLs:

| Config | Output |
|---|---|
| `recordDetail: true` | `__API_RECON_DETAIL__` |
| `observe.xhrHeaders: true` | Header observation |
| `extractUrlsFromResponse: true` | Sub-APIs inside responses |
| `observe.storageReads/cookieReads: true` | Back-fill config |
| `neutralizeVueRouter: true` | `__API_RECON_ROUTES__` |

Export each coverage round: `__API_RECON_LOG__`, `__API_RECON_DETAIL__`, `__API_RECON_ROUTES__`, `__API_RECON_OBSERVE__`.

---

## Phase 3 — Runtime

Gate B must already be passed; follow [Boundaries and Prohibitions](#boundaries-and-prohibitions-agent-must-read--violation-means-out-of-bounds) · the credential-less mock strategy.

Set `"runtimeMode": "depth" | "coverage" | "both"` in `config.json` (template in reference).

### Hooks and Stubs (shared by depth + coverage)

| Layer | Scope | Purpose |
|---|---|---|
| L1 precise | auth/permission/bootstrap stubs | Get past first-screen authentication |
| L2 negative correction | All JSON responses | Not-logged-in code → success |
| L3 fallback | `/api` etc. not matched by L1 | Empty success body to open up the UI |

- **depth**: fake auth + `forward` rewriting business codes + `stubs`; iterate over `routes` (hash/history); output `runtime_api.json`
- **coverage**: inject `preload.js` at **document-start** (CDP `addScriptToEvaluateOnNewDocument` or a userscript)

Verify: `window.__API_RECON_PRELOAD__` exists; business paths do not go back to `/login`.

```bash
cd recon && npm install
node runtime_harvest.js config.json
```

### 3b — Coverage Dynamic Enumeration (mandatory)

1. Main navigation/sidebar — click each item, wait 1–3s for the network
2. Tabs — `role=tab`, `.ant-tabs-tab`
3. Tables — view/edit/details on the first row
4. Toolbar — export, filter, create (**avoid irreversible deletes**)
5. On entering each module — merge APIs/routes
6. SPA — controlled `pushState` for paths in `routes.txt` not yet covered (forbidden for MPA)

**Parameter trigger matrix** (mandatory): for each module record once per operation type, and **diff the multiple samples**:

| Operation | Parameters that usually appear additionally |
|---|---|
| List first screen | Pagination + default filters |
| Click search | keyword, filter |
| Advanced filter | More optional ones |
| Create/edit | Full entity |
| Bulk/export/sort | `ids[]`, `exportType`, `sortField` |

**Under stubs, the outbound body/headers are still real**—go by the request. Record → `scan_raw.json`, `param_samples.json`, `api_detail.json`.

- **Vue**: `neutralizeVueRouter: true` + document-start preload
- **React**: `routes.txt` + sidebar clicks + `pushState`
- **both**: 3a depth first, then 3b coverage

---

## Phase 4 — Permission Tree Reconstruction

**Trigger**: module pages blank / each route only has bootstrap (e.g. locale) → content gate not passed.

| Symptom | Meaning |
|---|---|
| Got into the shell | Render gate + interceptor gate passed |
| Sidebar items missing/clicks blank | Stub shape or permission codes incomplete |
| Every route has the same, very few APIs | `v-if permission` not passed |
| `routes.txt` far smaller than the bundle | Must be completed from the auth module |

```bash
grep -rhoaE '"/api[^"]*(permission|perm|role|menu|acl)[^"]*"' OUTDIR/js/*.js | sort -u | head -30
grep -rhoaE 'userRouteAuth|getResultTree|routeMap|routeLink|menuList|authList' OUTDIR/js/*.js | head -20
```

Typical chain: `role_permissions` (flat codes) + `permissions/all` (tree) → `getResultTree` → `userRouteAuth[CODE].url`.

```bash
python3 recon/extract_route_map.py recon/js recon/
python3 recon/build_perm_tree.py recon/js recon/ --config recon/config.json
```

Intermediate outputs: `route_map.json`, `userRouteAuth.json`, `permissions_tree.json`, `*_stub.json`, `perm_codes_all.txt`.

Stub checks: outer `response_code` consistent with the interceptor gate; flat codes aligned with the tree; `routes` cover all links in `route_map`.

After updating `config.json`, **rerun Phase 3**. For large SPAs you can tune `waitUntil`, `routeTimeout`, `perRouteMs` (see reference sections A3/I).

---

## Phase 5 — Merge and Report

### Output Table

| File | Phase | Content |
|---|---|---|
| `js/`, `api_static.txt`, `routes.txt`, `chunkmap.txt` | 1 | Static bundles and paths |
| `param_candidates.json` | 1b | Static parameter field candidates |
| `config.json` | 2 | Three gates + runtime configuration |
| `runtime_api.json` | 3a | Detailed depth recording (incl. WS/SSE) |
| `param_samples.json`, `scan_raw.json`, `api_detail.json` | 3b | Multiple samples, click log, detail |
| `route_map.json` etc. | 4 | Permission tree intermediate files (if run) |
| `params_merged.json` | 5 | Merged parameter fields + confidence |
| `api_merged.txt` | 5 | `METHOD /path [params] [static\|runtime\|both]` |
| `site_map.json` | 5 | Routes, APIs, params, features, limitations |
| **insert_assets** | 5 | Write all service and endpoint assets into the asset store |

### 5b — Parameter Merging

Diff from `param_samples.json`; **there is no generic merge script**. Confidence rules in reference J7 (High/Medium/Low/Pending trigger).

### 5c — Inference from Errors

Within the authorized scope you may send incomplete requests and read the 400 (**this is parameter recon, not vulnerability testing**): `field 'x' is required`, enum errors, etc. Watch out for the `data` wrapper, `variables`, and pre-encryption `bizData`.

The report must state: runtimeMode, number of static/runtime APIs, parameter confidence, uncovered modules, and a summary of `CHANGES.md` relative to the reference scripts.

Suggested `site_map.json` structure:

```json
{
  "site": "https://example.com",
  "runtimeMode": "both",
  "appType": "vue-spa",
  "routeGuardStrategy": ["nav-neutralize", "L1-auth", "L2-patch", "forward"],
  "apisFromStatic": [],
  "apisFromRuntime": [],
  "apis": [],
  "params": [{ "method": "POST", "path": "/api/user/list", "transport": "json", "fields": [] }],
  "frontendRoutes": [],
  "routesVerifiedByClick": [],
  "featuresTriggered": [],
  "limitations": ""
}
```

More fields and grep recipes in [reference.md](reference.md).

---

## General Notes

- **Framework-agnostic**: the method is the same for webpack/Vite/Angular lazy load
- **Transport**: REST/JSON, GraphQL, WebSocket, SSE; gRPC-web is out of scope
- **SSR**: client-side fetches can be recorded; RSC/Server Actions are not fully enumerable
- **Blind spots**: JSVMP, WASM, strict HMAC/mTLS validation → static + note the limitations
- **Parameter blind spots**: conditional linkage, hidden params, WASM payload assembly → "Pending trigger" / "Unreachable"
- **Static is the safety net**: when runtime is blocked, static can still enumerate endpoints

---

## Additional Resources

- Grep recipes, `config.json` template, troubleshooting, hooks, section J on parameter reverse engineering, site_map template: **[reference.md](reference.md)**
- Reference script paths: see the [Scripts and Gates](#scripts-and-gates) table
