"use client";

import * as React from "react";

import { PlusIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Agent, MCPServer, MCPTool } from "@/lib/types";

type Transport = "stdio" | "http" | "sse";
type FormState = {
  name: string;
  transport: Transport;
  command: string;
  args: string;
  url: string;
  env: string;
  insecure: boolean;
};
const emptyForm: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  insecure: false,
};

export default function MCPPage() {
  const [servers, setServers] = React.useState<MCPServer[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [visibility, setVisibility] = React.useState<Record<number, string[]>>({});

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MCPServer | null>(null); // null = add mode
  const [tab, setTab] = React.useState<"config" | "tools">("config");
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [saving, setSaving] = React.useState(false);
  const [tools, setTools] = React.useState<MCPTool[]>([]);
  const [toolsLoading, setToolsLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(() => {
    api
      .agents()
      .then(setAgents)
      .catch(() => {});
    api
      .mcpServers()
      .then((ss) => {
        setServers(ss);
        ss.forEach((s) =>
          api
            .resourceVisibility("mcp", s.id)
            .then((ids) => setVisibility((v) => ({ ...v, [s.id]: ids })))
            .catch(() => {}),
        );
      })
      .catch(() => {});
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  function setF(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        if (key) out[key] = trimmed.slice(idx + 1).trim();
      }
    }
    return out;
  }
  function envToText(env: Record<string, string> | undefined): string {
    return Object.entries(env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setTools([]);
    setTab("config");
    setOpen(true);
  }

  function openEdit(s: MCPServer) {
    setEditing(s);
    setForm({
      name: s.name,
      transport: s.transport,
      command: s.command ?? "",
      args: (s.args ?? []).join(" "),
      url: s.url ?? "",
      env: envToText(s.env),
      insecure: s.insecure ?? false,
    });
    setTab("config");
    setOpen(true);
    loadTools(s.id);
  }

  async function loadTools(id: number) {
    setToolsLoading(true);
    try {
      setTools(await api.mcpTools(id));
    } catch {
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  }

  async function saveForm() {
    if (!form.name.trim()) {
      toast.error(tr("请填写名称", "Name is required"));
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      toast.error(tr("请填写命令", "Command is required"));
      return;
    }
    if (form.transport !== "stdio" && !form.url.trim()) {
      toast.error(tr("请填写远程 URL", "Remote URL is required"));
      return;
    }
    setSaving(true);
    try {
      const base =
        form.transport !== "stdio"
          ? {
              transport: form.transport,
              url: form.url.trim(),
              command: "",
              args: [] as string[],
              env: parseEnv(form.env), // in remote mode env holds the request headers
              insecure: form.insecure,
            }
          : {
              transport: "stdio" as const,
              command: form.command.trim(),
              args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
              env: parseEnv(form.env),
              insecure: false,
            };
      await api.saveMcpServer({
        ...(editing ? { id: editing.id } : {}),
        name: form.name.trim(),
        enabled: editing ? editing.enabled : true,
        ...base,
      });
      toast.success(editing ? tr("已保存", "Saved") : tr("已添加 MCP 服务器", "MCP server added"));
      if (!editing) setOpen(false);
      load();
    } catch (e) {
      toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshTools() {
    if (!editing) return;
    setRefreshing(true);
    try {
      const t = await api.refreshMcpServer(editing.id);
      setTools(t);
      toast.success(tr(`发现 ${t.length} 个工具`, `Found ${t.length} tool${t.length === 1 ? "" : "s"}`));
      load();
    } catch (e) {
      toast.error(tr("刷新失败：", "Refresh failed: ") + (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function removeServer(s: MCPServer) {
    try {
      await api.deleteMcpServer(s.id);
      toast.success(tr(`已删除：${s.name}`, `Deleted: ${s.name}`));
      setOpen(false);
      load();
    } catch (e) {
      toast.error(tr("删除失败：", "Delete failed: ") + (e as Error).message);
    }
  }

  async function toggleEnabled(s: MCPServer) {
    try {
      await api.saveMcpServer({ ...s, enabled: !s.enabled });
      load();
    } catch (e) {
      toast.error(tr("操作失败：", "Operation failed: ") + (e as Error).message);
    }
  }

  async function toggleVisibility(serverId: number, agentId: string, agentName: string) {
    const on = (visibility[serverId] ?? []).includes(agentId);
    try {
      await api.toggleVisibility(agentId, "mcp", serverId, !on);
      toast.success(
        on
          ? tr(`取消「${agentName}」可见`, `Hidden from "${agentName}"`)
          : tr(`授予「${agentName}」可见`, `Visible to "${agentName}"`),
      );
      load();
    } catch (e) {
      toast.error(tr("操作失败：", "Operation failed: ") + (e as Error).message);
    }
  }

  function renderForm() {
    return (
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label>{tr("传输方式", "Transport")}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.transport === "stdio" ? "default" : "outline"}
              onClick={() => setF({ transport: "stdio" })}
            >
              {tr("stdio（本地）", "stdio (local)")}
            </Button>
            <Button
              type="button"
              variant={form.transport === "http" ? "default" : "outline"}
              onClick={() => setF({ transport: "http" })}
            >
              {tr("http（远程）", "http (remote)")}
            </Button>
            <Button
              type="button"
              variant={form.transport === "sse" ? "default" : "outline"}
              onClick={() => setF({ transport: "sse" })}
            >
              {tr("sse（旧版）", "sse (legacy)")}
            </Button>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-name">{tr("名称", "Name")}</Label>
          <Input
            id="m-name"
            placeholder="filesystem"
            value={form.name}
            onChange={(e) => setF({ name: e.target.value })}
          />
        </div>
        {form.transport === "stdio" ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="m-cmd">{tr("命令", "Command")}</Label>
              <Input
                id="m-cmd"
                className="font-mono"
                placeholder="npx"
                value={form.command}
                onChange={(e) => setF({ command: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-args">{tr("参数（空格分隔）", "Arguments (space-separated)")}</Label>
              <Input
                id="m-args"
                className="font-mono"
                placeholder="-y @modelcontextprotocol/server-filesystem /data"
                value={form.args}
                onChange={(e) => setF({ args: e.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="m-url">{tr("远程 URL", "Remote URL")}</Label>
            <Input
              id="m-url"
              className="font-mono"
              placeholder="https://mcp.example.com/mcp"
              value={form.url}
              onChange={(e) => setF({ url: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.insecure} onCheckedChange={(v) => setF({ insecure: v === true })} />
              {tr("跳过 TLS 证书校验（自签证书）", "Skip TLS certificate verification (self-signed)")}
            </label>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="m-env">
            {form.transport !== "stdio"
              ? tr(
                  "请求头（每行 KEY=VALUE，如 Authorization=Bearer xxx）",
                  "Request headers (one KEY=VALUE per line, e.g. Authorization=Bearer xxx)",
                )
              : tr("环境变量（每行 KEY=VALUE）", "Environment variables (one KEY=VALUE per line)")}
          </Label>
          <Textarea
            id="m-env"
            className="font-mono"
            placeholder={form.transport !== "stdio" ? "Authorization=Bearer xxxx" : "API_KEY=xxxx\nFOO=bar"}
            value={form.env}
            onChange={(e) => setF({ env: e.target.value })}
          />
        </div>
      </div>
    );
  }

  function renderTools() {
    return (
      <div className="flex flex-col gap-3 py-4">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {tr(`${tools.length} 个工具`, `${tools.length} tool${tools.length === 1 ? "" : "s"}`)}
          </span>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={refreshTools}>
            <RefreshCwIcon className={refreshing ? "animate-spin" : ""} /> {tr("刷新", "Refresh")}
          </Button>
        </div>
        {toolsLoading ? (
          <p className="text-muted-foreground text-sm">{tr("加载中…", "Loading…")}</p>
        ) : tools.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("尚未发现工具，点击刷新重新获取。", "No tools discovered yet. Click Refresh to fetch them.")}
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {tools.map((t) => (
              <div key={t.name} className="py-2.5">
                <code className="font-mono text-sm">{t.name}</code>
                {t.description && (
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{t.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">MCP</h1>
        <p className="text-muted-foreground text-sm">
          {tr("外部 MCP 工具服务器 · 按 Agent 授权可见", "External MCP tool servers · visibility granted per agent")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={openAdd}
          className="text-foreground/70 border-foreground/70 hover:bg-muted/60 hover:shadow-sm flex min-h-[116px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition"
        >
          <PlusIcon className="size-6" />
          <span className="text-sm">{tr("添加 MCP", "Add MCP")}</span>
        </button>

        {servers.map((s) => (
          <Card
            key={s.id}
            onClick={() => openEdit(s)}
            className="hover:border-primary/60 cursor-pointer gap-3 transition hover:shadow-sm"
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <ServerIcon className="text-muted-foreground size-4 shrink-0" />
                <CardTitle className="truncate text-base">{s.name}</CardTitle>
                <Badge variant="outline" className="uppercase">
                  {s.transport}
                </Badge>
                <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={() => toggleEnabled(s)}
                    aria-label={tr("启用", "Enable")}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={tr("删除", "Delete")}
                    onClick={() => removeServer(s)}
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-muted-foreground text-sm">
                {s.tools && s.tools.length > 0
                  ? tr(`${s.tools.length} 个工具`, `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}`)
                  : tr("尚未发现工具", "No tools discovered yet")}
              </p>
              <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="text-muted-foreground text-xs">
                  {tr("可见性（按 Agent 授权）", "Visibility (per agent)")}
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {agents.map((a) => (
                    <label key={a.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={(visibility[s.id] ?? []).includes(a.id)}
                        onCheckedChange={() => toggleVisibility(s.id, a.id, a.name)}
                      />
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? editing.name : tr("添加 MCP 服务器", "Add MCP server")}</SheetTitle>
            <SheetDescription>
              {tr(
                "stdio（本地起进程）或 http（远程 Streamable HTTP）",
                "stdio (spawns a local process) or http (remote Streamable HTTP)",
              )}
            </SheetDescription>
          </SheetHeader>

          {editing ? (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as "config" | "tools")}
              className="flex min-h-0 flex-1 flex-col px-4"
            >
              <TabsList>
                <TabsTrigger value="config">{tr("配置", "Config")}</TabsTrigger>
                <TabsTrigger value="tools">
                  {tr("工具列表", "Tools")}
                  {tools.length ? tr(`（${tools.length}）`, ` (${tools.length})`) : ""}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
                {renderForm()}
                <div className="flex gap-2 pt-2 pb-6">
                  <Button onClick={saveForm} disabled={saving}>
                    {tr("保存", "Save")}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto">
                {renderTools()}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
              {renderForm()}
              <div className="pt-2 pb-6">
                <Button onClick={saveForm} disabled={saving}>
                  <PlusIcon /> {tr("添加", "Add")}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
