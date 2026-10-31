import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configFromEnv, ScopeWeaverClient } from "../src/client.js";
import { createTools, executeTool } from "../src/tools.js";
import extension from "../pi-extension.js";

async function fixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("configuration rejects unsafe origins and invalid options without printing credentials", () => {
  for (const url of ["http://example.com", "https://secret@example.com", "https://example.com/api/", "https://example.com?token=secret", "file:///tmp/x"]) {
    assert.throws(() => configFromEnv({ SCOPEWEAVER_URL: url }), (error) => !error.message.includes("secret"));
  }
  for (const options of [{ SCOPEWEAVER_TIMEOUT_MS: "NaN" }, { SCOPEWEAVER_TIMEOUT_MS: "0" },
    { SCOPEWEAVER_LANGUAGE: "xx" }, { SCOPEWEAVER_ALLOW_WRITES: "yes" }, { SCOPEWEAVER_TOKEN: "x\ny" },
    { SCOPEWEAVER_USERNAME: "a b" }, { SCOPEWEAVER_USERNAME: "ab" },
    { SCOPEWEAVER_URL: "https://example.com", SCOPEWEAVER_CF_ACCESS_CLIENT_ID: "only-id" },
    { SCOPEWEAVER_CF_ACCESS_CLIENT_ID: "id", SCOPEWEAVER_CF_ACCESS_CLIENT_SECRET: "secret" }]) {
    assert.throws(() => configFromEnv(options));
  }
  const vi = configFromEnv({ SCOPEWEAVER_LANGUAGE: "vi", SCOPEWEAVER_USERNAME: "kytt.admin" });
  assert.equal(vi.language, "vi");
  assert.equal(vi.username, "kytt.admin");
  assert.equal(configFromEnv({}).username, "ARTEX");
});

test("writes are absent by default and unknown/path-injection arguments are rejected before HTTP", async () => {
  const client = new ScopeWeaverClient(configFromEnv({}));
  const reads = createTools(client);
  assert.equal(reads.length, 12);
  // export_findings writes a local file only; nothing changes on the server.
  assert.ok(reads.every((tool) => tool.annotations.readOnlyHint || tool.name === "scopeweaver_export_findings"));
  assert.ok(reads.every((tool) => !tool.annotations.destructiveHint));
  const tool = reads.find((tool) => tool.name === "scopeweaver_get_task");
  await assert.rejects(executeTool(tool, { task_id: "../../settings" }));
  await assert.rejects(executeTool(tool, { task_id: "1", command: "ignored" }));
  const writes = createTools(new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_ALLOW_WRITES: "true" })));
  assert.equal(writes.length, 21);
  const create = writes.find((tool) => tool.name === "scopeweaver_create_task");
  assert.equal(create.schema.parse({ description: "lab", goal: "test" }).timeout_seconds, 600);
  await assert.rejects(executeTool(create, { description: " ", goal: "test" }));
  await assert.rejects(executeTool(create, { description: "lab", goal: "test", timeout_seconds: 0 }));
});

test("concurrent calls share login, send authorization and Korean locale, and paginate tasks", async (t) => {
  let logins = 0;
  const url = await fixture(t, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/auth/login") {
      logins++;
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { username: "ARTEX", password: "fixture-password" });
      return res.end(JSON.stringify({ token: "fixture-token" }));
    }
    assert.equal(req.headers.authorization, "Bearer fixture-token");
    assert.equal(req.headers["accept-language"], "ko");
    res.end(JSON.stringify({ tasks: [{ id: "3" }, { id: "2" }, { id: "1" }], active: "3" }));
  });
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_PASSWORD: "fixture-password", SCOPEWEAVER_LANGUAGE: "ko" }));
  const tool = createTools(client).find((tool) => tool.name === "scopeweaver_list_tasks");
  const results = await Promise.all([executeTool(tool, { page: 2, limit: 1 }), executeTool(tool, {})]);
  assert.equal(logins, 1);
  assert.deepEqual(results[0].structuredContent.data.tasks, [{ id: "2" }]);
  assert.equal(results[0].structuredContent.data.total, 3);
});

test("backend errors redact credentials and writes are never retried", async (t) => {
  let requests = 0;
  const url = await fixture(t, (req, res) => {
    requests++;
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fixture-token fixture-password" }));
  });
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token", SCOPEWEAVER_PASSWORD: "fixture-password" }));
  await assert.rejects(client.request("/api/tasks", { method: "POST", body: {} }), (error) => {
    assert.match(error.message, /HTTP 401.*redacted.*Sign in again/);
    assert.ok(!error.message.includes("fixture-token"));
    assert.ok(!error.message.includes("fixture-password"));
    return true;
  });
  assert.equal(requests, 1);
});

test("redirects do not forward credentials to another server", async (t) => {
  let leaked = false;
  const destination = await fixture(t, (_, res) => { leaked = true; res.end("{}"); });
  const url = await fixture(t, (_, res) => { res.writeHead(302, { Location: destination }); res.end(); });
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token" }));
  await assert.rejects(client.request("/api/tasks"));
  assert.equal(leaked, false);
});

test("timeouts, cancellation, malformed JSON and excessive responses fail explicitly", async (t) => {
  const url = await fixture(t, (req, res) => {
    if (req.url === "/api/invalid") return res.end("html");
    if (req.url === "/api/large") return res.end("x".repeat(2 * 1024 * 1024 + 1));
    // /api/hang intentionally leaves the response open.
  });
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token", SCOPEWEAVER_TIMEOUT_MS: "100" }));
  await assert.rejects(client.request("/api/invalid"), /non-JSON/);
  await assert.rejects(client.request("/api/large"), /exceeds 2 MiB/);
  await assert.rejects(client.request("/api/hang"), /timed out/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.request("/api/hang", { signal: controller.signal }), /cancelled/);
});

test("Pi extension shares schemas and reports backend failures by throwing", async () => {
  const tools = [];
  extension({ registerTool: (tool) => tools.push(tool) });
  assert.equal(tools.length, process.env.SCOPEWEAVER_ALLOW_WRITES === "true" ? 21 : 12);
  const task = tools.find((tool) => tool.name === "scopeweaver_get_task");
  assert.equal(task.parameters.type, "object");
  await assert.rejects(task.execute("id", { task_id: "../settings" }), /Invalid/);
});

test("named account login, Vietnamese locale and Cloudflare Access headers", async (t) => {
  const url = await fixture(t, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    assert.equal(req.headers["cf-access-client-id"], "fixture-id.access");
    assert.equal(req.headers["cf-access-client-secret"], "fixture-cf-secret");
    assert.equal(req.headers["accept-language"], "vi");
    if (req.url === "/api/auth/login") {
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { username: "operator.a", password: "fixture-password" });
      return res.end(JSON.stringify({ token: "fixture-token" }));
    }
    assert.equal(req.headers.authorization, "Bearer fixture-token");
    res.end(JSON.stringify({ total: 3 }));
  });
  // The fixture is HTTP on loopback; Access headers require HTTPS, so build the config by hand.
  const config = { ...configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_PASSWORD: "fixture-password", SCOPEWEAVER_LANGUAGE: "vi", SCOPEWEAVER_USERNAME: "operator.a" }),
    cfAccess: { id: "fixture-id.access", secret: "fixture-cf-secret" } };
  const client = new ScopeWeaverClient(config);
  const stats = createTools(client).find((tool) => tool.name === "scopeweaver_finding_stats");
  assert.deepEqual((await executeTool(stats, {})).structuredContent.data, { total: 3 });
});

test("a redirect (Access login page) is reported, not followed, and the secret is not echoed", async (t) => {
  const url = await fixture(t, (_, res) => { res.writeHead(302, { Location: "https://example.cloudflareaccess.com/login" }); res.end(); });
  const client = new ScopeWeaverClient({ ...configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token" }) });
  await assert.rejects(client.request("/api/tasks"), (error) => {
    assert.match(error.message, /redirected.*HTTP 302.*SCOPEWEAVER_CF_ACCESS_CLIENT_ID/);
    return true;
  });
});

test("export_findings saves the file inside the export dir without overwriting", async (t) => {
  const seen = [];
  const url = await fixture(t, (req, res) => {
    seen.push(req.url);
    res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="../../findings-20261028.zip"' });
    res.end("PK fixture");
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-export-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token", SCOPEWEAVER_EXPORT_DIR: dir }));
  const exp = createTools(client).find((tool) => tool.name === "scopeweaver_export_findings");
  const first = (await executeTool(exp, { severity: "high", task_id: "7" })).structuredContent.data;
  const second = (await executeTool(exp, { finding_ids: ["3", "9"], format: "md-zip" })).structuredContent.data;
  assert.equal(path.dirname(first.file), path.resolve(dir));
  assert.equal(path.basename(first.file), "findings-20261028.zip");
  assert.equal(path.basename(second.file), "findings-20261028-1.zip");
  assert.equal(fs.readFileSync(first.file, "utf8"), "PK fixture");
  assert.match(seen[0], /scope=filtered/);
  assert.match(seen[0], /severity=high/);
  assert.match(seen[0], /task_id=7/);
  assert.match(seen[1], /scope=selected&ids=3%2C9&format=md-zip/);
  await assert.rejects(executeTool(exp, { finding_ids: ["1"], severity: "low" }), /either finding_ids or filters/);
});

test("update_findings previews by default, applies only changed fields, and reports per-item errors", async (t) => {
  const state = { "5": { finding_id: "5", name: "SQLi login", status: "pending", severity: "high" },
    "6": { finding_id: "6", name: "Dup SQLi", status: "pending", severity: "high" } };
  const patches = [];
  const url = await fixture(t, async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const m = req.url.match(/^\/api\/exploration\/findings\/(\d+)$/);
    if (!m || !state[m[1]]) { res.statusCode = 404; return res.end(JSON.stringify({ error: "finding not found" })); }
    if (req.method === "PATCH") {
      let body = "";
      for await (const chunk of req) body += chunk;
      patches.push({ id: m[1], body: JSON.parse(body) });
      Object.assign(state[m[1]], JSON.parse(body));
    }
    res.end(JSON.stringify(state[m[1]]));
  });
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token", SCOPEWEAVER_ALLOW_WRITES: "true" }));
  const upd = createTools(client).find((tool) => tool.name === "scopeweaver_update_findings");
  const changes = [{ finding_id: "5", status: "confirmed", severity: "high" }, { finding_id: "6", status: "duplicate" }, { finding_id: "9", status: "false_positive" }];
  const preview = (await executeTool(upd, { changes })).structuredContent.data;
  assert.equal(preview.dry_run, true);
  assert.equal(preview.planned, 2);
  assert.equal(preview.errors, 1);
  assert.deepEqual(preview.results[0].changes, { status: { from: "pending", to: "confirmed" } });
  assert.equal(patches.length, 0, "dry run must not write");
  const applied = (await executeTool(upd, { dry_run: false, changes })).structuredContent.data;
  assert.equal(applied.updated, 2);
  assert.deepEqual(patches, [{ id: "5", body: { status: "confirmed" } }, { id: "6", body: { status: "duplicate" } }]);
  const again = (await executeTool(upd, { dry_run: false, changes: changes.slice(0, 2) })).structuredContent.data;
  assert.equal(again.unchanged, 2);
  await assert.rejects(executeTool(upd, { changes: [{ finding_id: "5" }] }), /no field/);
  await assert.rejects(executeTool(upd, { changes: [{ finding_id: "5", status: "fixed" }, { finding_id: "5", severity: "low" }] }), /more than once/);
  assert.equal(createTools(new ScopeWeaverClient(configFromEnv({}))).some((tool) => tool.name === "scopeweaver_update_findings"), false);
});

test("steering tools hit the right endpoint and refuse an incomplete call before any request", async (t) => {
  const seen = [];
  const url = await fixture(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  const client = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "fixture-token", SCOPEWEAVER_ALLOW_WRITES: "true" }));
  const tools = createTools(client);
  const byName = (n) => tools.find((x) => x.name === `scopeweaver_${n}`);

  // An argument the backend would reject must fail in the adapter, so a
  // half-specified edit never reaches a running engagement.
  await assert.rejects(executeTool(byName("manage_goals"), { task_id: "7", action: "edit", goal_id: "3" }), /text is required/);
  await assert.rejects(executeTool(byName("manage_goals"), { task_id: "7", action: "delete" }), /goal_id is required/);
  await assert.rejects(executeTool(byName("manage_constraints"), { task_id: "7", action: "add", text: "only port 443" }), /kind are required/);
  await assert.rejects(executeTool(byName("control_intent"), { task_id: "7", intent_id: "9", action: "cancel" }), /reason is required/);
  assert.equal(seen.length, 0, "a rejected call must not reach the backend");

  await executeTool(byName("manage_goals"), { task_id: "7", action: "add", text: "Prove unauthenticated export" });
  await executeTool(byName("manage_goals"), { task_id: "7", action: "delete", goal_id: "3" });
  await executeTool(byName("manage_constraints"), { task_id: "7", action: "add", text: "only test port 443", kind: "deny" });
  await executeTool(byName("control_intent"), { task_id: "7", intent_id: "9", action: "rerun" });
  await executeTool(byName("control_intent"), { task_id: "7", intent_id: "9", action: "cancel", reason: "out of time" });
  await executeTool(byName("steer_worker"), { task_id: "7", intent_id: "9", message: "stop fuzzing, verify the IDOR" });
  await executeTool(byName("set_task_llm"), { task_id: "7", profile_ids: [1, 3], active_profile_id: 1 });
  await executeTool(byName("tell_main_agent"), { task_id: "7", message: "focus on the upload endpoint" });

  assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), [
    "POST /api/tasks/7/goals",
    "DELETE /api/tasks/7/goals/3",
    "POST /api/tasks/7/constraints",
    "POST /api/tasks/7/intents/9/rerun",
    "POST /api/tasks/7/intents/9/control",
    "POST /api/tasks/7/intents/9/messages",
    "PUT /api/tasks/7/llm",
    "POST /api/chat?task=7",
  ]);
  // The hard cancel mode cascades into saved facts and findings, so it must
  // never be sent, whatever the model passes.
  const cancel = seen.find((s) => s.url.endsWith("/control"));
  assert.deepEqual(cancel.body, { action: "cancel", reason: "out of time" });
  assert.equal("mode" in cancel.body, false);
  assert.deepEqual(seen.find((s) => s.url.endsWith("/llm")).body, { llm_profile_ids: [1, 3], active_llm_profile_id: 1 });
});

test("scope cannot be widened through the adapter, and steering is not marked destructive", () => {
  const tools = createTools(new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_ALLOW_WRITES: "true" })));
  const names = tools.map((x) => x.name);
  // Adding or removing a task scope entry is the authorization boundary, and
  // the adapter's own context carries untrusted target content.
  for (const forbidden of ["scopeweaver_add_task_scope", "scopeweaver_manage_scope", "scopeweaver_delete_assets", "scopeweaver_insert_assets"]) {
    assert.ok(!names.includes(forbidden), `${forbidden} must not be exposed`);
  }
  for (const soft of ["steer_worker", "set_task_llm", "tell_main_agent"]) {
    const t = tools.find((x) => x.name === `scopeweaver_${soft}`);
    assert.equal(t.annotations.destructiveHint, false, `${soft} removes nothing and must not be marked destructive`);
    assert.equal(t.annotations.readOnlyHint, false, `${soft} changes state and must not be marked read-only`);
  }
  for (const hard of ["manage_goals", "manage_constraints", "control_intent"]) {
    assert.equal(tools.find((x) => x.name === `scopeweaver_${hard}`).annotations.destructiveHint, true,
      `${hard} can delete and must be marked destructive so the host prompts`);
  }
});

test("a rejected username is named, since this build answers it with the same 401 as a wrong password", async (t) => {
  const url = await fixture(t, (_, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid username or password" }));
  });
  const named = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_USERNAME: "claude", SCOPEWEAVER_PASSWORD: "fixture-password" }));
  await assert.rejects(named.request("/api/tasks"), (error) => {
    assert.match(error.message, /SCOPEWEAVER_USERNAME is set to "claude"/);
    assert.match(error.message, /ARTEX/);
    assert.ok(!error.message.includes("fixture-password"), "the password must stay out of the message");
    return true;
  });
  // With the accepted name the hint would be wrong, so it must not appear.
  const dflt = new ScopeWeaverClient(configFromEnv({ SCOPEWEAVER_URL: url, SCOPEWEAVER_PASSWORD: "fixture-password" }));
  await assert.rejects(dflt.request("/api/tasks"), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes("SCOPEWEAVER_USERNAME"), "no username hint when the name is already the accepted one");
    return true;
  });
});
