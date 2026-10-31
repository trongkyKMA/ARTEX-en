import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import extension from "../pi-extension.js";

// These cases need a backend plus a seeded finding, which a Go harness used to
// provide. This repository has no test-database infrastructure to port it onto,
// so they skip rather than fail: point SCOPEWEAVER_E2E_URL and
// SCOPEWEAVER_E2E_PASSWORD at a DISPOSABLE instance to run them. They create
// tasks and edit goals, so never aim them at an instance holding real work.
const url = process.env.SCOPEWEAVER_E2E_URL;
const skip = url ? false : "set SCOPEWEAVER_E2E_URL and SCOPEWEAVER_E2E_PASSWORD to a disposable instance";
const password = process.env.SCOPEWEAVER_E2E_PASSWORD;
const findingID = process.env.SCOPEWEAVER_E2E_FINDING_ID;
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-e2e-export-"));
test.after(() => fs.rmSync(exportDir, { recursive: true, force: true }));

// The developer's own adapter settings (a real URL, username, Cloudflare Access
// token) must never reach the disposable fixture backend.
const cleanEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith("SCOPEWEAVER_") || key.startsWith("SCOPEWEAVER_E2E_")));
for (const key of Object.keys(process.env)) {
  if (key.startsWith("SCOPEWEAVER_") && !key.startsWith("SCOPEWEAVER_E2E_")) delete process.env[key];
}

async function connect(t, overrides = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("../src/mcp.js", import.meta.url))],
    env: { ...cleanEnv, SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "", SCOPEWEAVER_PASSWORD: password,
      SCOPEWEAVER_ALLOW_WRITES: "true", SCOPEWEAVER_EXPORT_DIR: exportDir, ...overrides }, stderr: "pipe",
  });
  const client = new Client({ name: "scopeweaver-e2e", version: "1.0.0" });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name: `scopeweaver_${name}`, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent.data;
}

test("MCP stdio → real authenticated backend → persisted task, controls, coverage and findings", { skip }, async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 21);
  assert.equal(tools.find((tool) => tool.name === "scopeweaver_create_task").annotations.readOnlyHint, false);
  const health = await call(client, "health");
  assert.ok(health);
  const created = await call(client, "create_task", {
    name: "Agent adapter E2E", description: "Local isolated fixture; do not contact targets.", goal: "Record a task for adapter verification.",
  });
  assert.match(created.id, /^[1-9][0-9]*$/);
  assert.equal(created.goal, "Record a task for adapter verification.");
  const task = await call(client, "get_task", { task_id: created.id });
  assert.equal(task.id, created.id);
  const listed = await call(client, "list_tasks", { limit: 100 });
  assert.ok(listed.tasks.some((task) => task.id === created.id));
  await call(client, "control_task", { task_id: created.id, action: "pause" });
  assert.equal((await call(client, "get_task", { task_id: created.id })).paused, true);
  await call(client, "control_task", { task_id: created.id, action: "resume" });
  assert.equal((await call(client, "get_task", { task_id: created.id })).paused, false);
  assert.ok(await call(client, "get_coverage", { task_id: created.id }));
  const findings = await call(client, "list_findings", { severity: "high", q: "adapter fixture" });
  assert.ok(findings.items.some((finding) => finding.id === findingID));
  const finding = await call(client, "get_finding", { finding_id: findingID });
  assert.equal(finding.id, findingID);
  assert.match(finding.evidence, /SIMULATED/);
  const empty = await call(client, "list_findings", { task_id: created.id });
  assert.equal(empty.total, 0);
  assert.ok(await call(client, "finding_stats"));
  const exported = await call(client, "export_findings", { format: "json", finding_ids: [findingID] });
  const rows = JSON.parse(fs.readFileSync(exported.file, "utf8"));
  assert.ok(rows.some((row) => row.finding_id === findingID || row.id === findingID));
  const zip = await call(client, "export_findings", { severity: "high" });
  assert.equal(fs.readFileSync(zip.file).subarray(0, 2).toString(), "PK");
  const triage = [{ finding_id: findingID, status: "confirmed", severity: "medium" }];
  const preview = await call(client, "update_findings", { changes: triage });
  assert.equal(preview.planned, 1);
  assert.equal((await call(client, "get_finding", { finding_id: findingID })).status, finding.status, "dry run must not write");
  const applied = await call(client, "update_findings", { dry_run: false, changes: triage });
  assert.equal(applied.updated, 1);
  const after = await call(client, "get_finding", { finding_id: findingID });
  assert.equal(after.status, "confirmed");
  assert.equal(after.severity, "medium");
  const page = await call(client, "list_tasks", { page: 100, limit: 1 });
  assert.equal(page.tasks.length, 0);
});

test("MCP surfaces authentication, missing tasks and invalid input as errors; read-only mode hides writes", { skip }, async (t) => {
  const readonly = await connect(t, { SCOPEWEAVER_ALLOW_WRITES: "false" });
  assert.equal((await readonly.listTools()).tools.length, 12);
  const disabled = await readonly.callTool({ name: "scopeweaver_create_task", arguments: { description: "x", goal: "y" } });
  assert.equal(disabled.isError, true);
  assert.match(disabled.content[0].text, /not found/);
  const missing = await readonly.callTool({ name: "scopeweaver_get_task", arguments: { task_id: "999999999" } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /HTTP 404/);
  const invalid = await readonly.callTool({ name: "scopeweaver_get_task", arguments: { task_id: "../settings" } });
  assert.equal(invalid.isError, true);
  const invalidAuth = await connect(t, { SCOPEWEAVER_TOKEN: "invalid-fixture-token", SCOPEWEAVER_PASSWORD: "" });
  const denied = await invalidAuth.callTool({ name: "scopeweaver_list_tasks", arguments: {} });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /HTTP 401/);
  assert.ok(!denied.content[0].text.includes("invalid-fixture-token"));
});

test("Pi tools → same real backend → create and read task, retrieve evidence, reject bad IDs", { skip }, async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { SCOPEWEAVER_URL: url, SCOPEWEAVER_TOKEN: "", SCOPEWEAVER_PASSWORD: password, SCOPEWEAVER_ALLOW_WRITES: "true" });
  const tools = new Map();
  try { extension({ registerTool: (tool) => tools.set(tool.name, tool) }); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const run = async (name, args) => (await tools.get(`scopeweaver_${name}`).execute("e2e", args)).details.data;
  const created = await run("create_task", { description: "Pi local fixture", goal: "Verify Pi tool adapter" });
  assert.equal((await run("get_task", { task_id: created.id })).goal, "Verify Pi tool adapter");
  assert.equal((await run("get_finding", { finding_id: findingID })).id, findingID);
  await assert.rejects(run("get_task", { task_id: "../settings" }));
  await assert.rejects(run("get_task", { task_id: "999999999" }), /HTTP 404/);
});

// The steering tools are only as good as the endpoint shapes they assume, so
// exercise each against the real handlers rather than a fixture server.
test("goal and constraint management round-trips against the real backend", { skip }, async (t) => {
  const client = await connect(t);
  const created = await call(client, "create_task", {
    name: "Steering E2E", description: "Local isolated fixture; do not contact targets.", goal: "Hold goals for adapter verification.",
  });

  const before = await call(client, "list_goals", { task_id: created.id });
  assert.ok(Array.isArray(before.goals ?? before), `list_goals returned an unexpected shape: ${JSON.stringify(before).slice(0, 200)}`);
  const goalsOf = (r) => r.goals ?? r;

  await call(client, "manage_goals", { task_id: created.id, action: "add", text: "Prove the adapter can add a goal" });
  const added = goalsOf(await call(client, "list_goals", { task_id: created.id }));
  const mine = added.find((g) => (g.text ?? g.summary ?? "").includes("add a goal"));
  assert.ok(mine, `added goal not listed: ${JSON.stringify(added).slice(0, 300)}`);

  await call(client, "manage_goals", { task_id: created.id, action: "edit", goal_id: String(mine.id), text: "Edited by the adapter" });
  const edited = goalsOf(await call(client, "list_goals", { task_id: created.id })).find((g) => String(g.id) === String(mine.id));
  assert.match(edited.text ?? edited.summary ?? "", /Edited by the adapter/);

  await call(client, "manage_goals", { task_id: created.id, action: "delete", goal_id: String(mine.id) });
  assert.equal(goalsOf(await call(client, "list_goals", { task_id: created.id })).some((g) => String(g.id) === String(mine.id)), false);

  await call(client, "manage_constraints", { task_id: created.id, action: "add", text: "Only test 127.0.0.1; do not scan other hosts", kind: "deny" });
  const cons = await call(client, "list_constraints", { task_id: created.id });
  const list = cons.constraints ?? cons;
  const c = list.find((x) => (x.text ?? "").includes("127.0.0.1"));
  assert.ok(c, `added constraint not listed: ${JSON.stringify(list).slice(0, 300)}`);
  assert.equal(c.kind, "deny");
  await call(client, "manage_constraints", { task_id: created.id, action: "delete", constraint_id: String(c.id) });

  // kind=goal proves the exploration-graph read reaches this task's own nodes.
  const nodes = await call(client, "list_nodes", { task_id: created.id, kind: "goal" });
  assert.ok(nodes, "list_nodes returned nothing for kind=goal");
  assert.ok(await call(client, "list_assets", { limit: 5 }), "list_assets returned nothing");
});
