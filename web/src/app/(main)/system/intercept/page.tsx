"use client";

import * as React from "react";

import { BotIcon, ListFilterIcon, PencilIcon, PlusIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { intlLocale, tr } from "@/lib/i18n";
import type {
  InterceptAction,
  InterceptRule,
  JudgeConfig,
  JudgeDayUsage,
  JudgeUsage,
  LLMProfile,
  Tool,
} from "@/lib/types";

// fmtTokens compresses a token count into compact form (1.2k / 3.4M), for approval usage stats.
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

// JudgeStat is one stat figure (label + value).
function JudgeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// JudgeSparkbars draws a mini bar chart of daily consumption (input+output) over the last N days with plain divs, avoiding a chart library dependency.
function JudgeSparkbars({ daily }: { daily: JudgeDayUsage[] }) {
  const max = Math.max(1, ...daily.map((d) => d.input_tokens + d.output_tokens));
  return (
    <div className="flex h-16 items-end gap-0.5">
      {daily.map((d) => {
        const total = d.input_tokens + d.output_tokens;
        const h = Math.max(2, Math.round((total / max) * 100));
        return (
          <div
            key={d.date}
            title={tr(
              `${d.date} · ${d.calls} 次 · ${fmtTokens(total)} tokens`,
              `${d.date} · ${d.calls} call${d.calls === 1 ? "" : "s"} · ${fmtTokens(total)} tokens`,
            )}
            className="min-w-[2px] flex-1 rounded-sm bg-violet-500/60 hover:bg-violet-500"
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}

// ---- tool scope ----

// SDK tools are intentionally not seeded into the DB (they apply to every agent
// and have no per-agent binding). We hardcode them here so they still appear in
// the scope dialog.
function sdkTool(key: string, description: string): Tool {
  return { key, system: true, description, schema: {}, agents: [], enabled: true, kind: "builtin" };
}

const SDK_EXEC: Tool[] = [
  sdkTool("Bash", tr("在 shell 中执行命令", "Run commands in a shell")),
  sdkTool("WebFetch", tr("发起 HTTP/HTTPS 请求（含代理支持）", "Make HTTP/HTTPS requests (proxy supported)")),
  sdkTool("web_search", tr("网络搜索", "Web search")),
  sdkTool("shell_open", tr("开启持久 PTY 交互会话", "Open a persistent interactive PTY session")),
  sdkTool("shell_send", tr("向交互会话发送输入", "Send input to an interactive session")),
  sdkTool("shell_read", tr("读取交互会话输出", "Read output from an interactive session")),
  sdkTool("shell_close", tr("关闭交互会话", "Close an interactive session")),
  sdkTool("shell_list", tr("列出所有交互会话", "List all interactive sessions")),
];

const SDK_WRITE: Tool[] = [
  sdkTool("Write", tr("写入文件", "Write a file")),
  sdkTool("Edit", tr("编辑文件（精确替换）", "Edit a file (exact replacement)")),
  sdkTool("MultiEdit", tr("批量编辑文件", "Batch-edit a file")),
];

const SDK_KEYS = new Set([...SDK_EXEC, ...SDK_WRITE].map((t) => t.key));

function groupTools(dbTools: Tool[]) {
  const sys: Tool[] = [],
    custom: Tool[] = [];
  for (const t of dbTools) {
    if (SDK_KEYS.has(t.key)) continue; // already covered by hardcoded groups
    if (t.system) sys.push(t);
    else custom.push(t);
  }
  return [
    { label: tr("执行类", "Execution"), tools: SDK_EXEC },
    { label: tr("写入/编辑类", "Write / edit"), tools: SDK_WRITE },
    { label: tr("系统工具", "System tools"), tools: sys },
    { label: tr("自定义工具", "Custom tools"), tools: custom },
  ].filter((g) => g.tools.length > 0);
}

// ---- form state ----

type RuleForm = {
  name: string;
  enabled: boolean;
  priority: number;
  match_target: "tool_name" | "tool_input";
  match_type: "string" | "regex";
  pattern: string;
  action: InterceptAction;
  message: string;
  timeout_enabled: boolean;
  timeout_seconds: number;
  timeout_action: "deny" | "allow";
};

const defaultForm = (): RuleForm => ({
  name: "",
  enabled: true,
  priority: 0,
  match_target: "tool_name",
  match_type: "string",
  pattern: "",
  action: "deny",
  message: "",
  timeout_enabled: true,
  timeout_seconds: 60,
  timeout_action: "deny",
});

// ---- small components ----

function ActionBadge({ action }: { action: InterceptAction }) {
  if (action === "allow") return <Badge variant="secondary">{tr("允许", "Allow")}</Badge>;
  if (action === "deny") return <Badge variant="destructive">{tr("禁止", "Deny")}</Badge>;
  return (
    <Badge variant="outline" className="border-amber-400 text-amber-600">
      {tr("申请", "Ask")}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

// ---- LLM fallback judge card ----

const FOLLOW_ACTIVE = "0"; // profile_id 0 = follow the active/default profile

const defaultJudge = (): JudgeConfig => ({
  enabled: false,
  profile_id: 0,
  prompt: "",
  timeout_seconds: 15,
  fail_action: "allow",
  ask_timeout_seconds: 300,
  ask_timeout_action: "deny",
});

function JudgeCard() {
  const [cfg, setCfg] = React.useState<JudgeConfig>(defaultJudge());
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [usage, setUsage] = React.useState<JudgeUsage | null>(null);

  // Approval usage stats: failures don't interrupt the settings page; fetched only when enabled.
  const loadUsage = React.useCallback(async () => {
    try {
      setUsage(await api.interceptJudgeUsage(30));
    } catch {
      // Ignore: unavailable stats should not affect editing the configuration
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [j, ps] = await Promise.all([api.interceptGetJudgeConfig(), api.llmProfiles()]);
      setCfg(j);
      setProfiles(ps);
    } catch (e) {
      toast.error(tr("加载模型兜底配置失败: ", "Failed to load the model fallback config: ") + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Fetch approval usage stats once enabled (including when the initial load reads the switch as true).
  React.useEffect(() => {
    if (cfg.enabled) loadUsage();
  }, [cfg.enabled, loadUsage]);

  function patch(p: Partial<JudgeConfig>) {
    setCfg((c) => ({ ...c, ...p }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.interceptSetJudgeConfig(cfg);
      toast.success(tr("模型兜底配置已保存", "Model fallback config saved"));
      await load(); // read back: if the prompt was cleared, the built-in template is filled back in
    } catch (e) {
      toast.error(tr("保存失败: ", "Save failed: ") + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function restorePrompt() {
    // Clear the prompt and save → the server returns the full built-in template next time, which is filled back into the input.
    setSaving(true);
    try {
      await api.interceptSetJudgeConfig({ ...cfg, prompt: "" });
      const j = await api.interceptGetJudgeConfig();
      setCfg(j);
      toast.success(tr("已恢复内置默认模板", "Restored the built-in default template"));
    } catch (e) {
      toast.error(tr("恢复失败: ", "Restore failed: ") + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Enable switch -- separate highlighted bar */}
      <div
        className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
          cfg.enabled ? "border-violet-400/50 bg-violet-50/40 dark:bg-violet-950/20" : "bg-muted/40"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <BotIcon className={`h-5 w-5 shrink-0 ${cfg.enabled ? "text-violet-600" : "text-muted-foreground"}`} />
          <div>
            <p className="text-sm font-semibold leading-tight">{tr("模型兜底审批", "Model fallback approval")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tr("在", "Only commands ")}
              <span className="font-medium text-foreground">{tr("拦截范围", "within the intercept scope")}</span>
              {tr("内、且", " that ")}
              <span className="font-medium text-foreground">
                {tr("没有任何拦截规则命中", "match no intercept rule")}
              </span>
              {tr(
                "的命令，才由模型做语义判断（放行 / 转人工 / 拦截）",
                " are judged semantically by the model (allow / hand to a human / block)",
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {cfg.enabled ? tr("已启用", "Enabled") : tr("未启用", "Disabled")}
          </span>
          <Switch checked={cfg.enabled} disabled={loading} onCheckedChange={(v) => patch({ enabled: v })} />
        </div>
      </div>

      {/* Approval token usage stats (global cumulative, independent of each model configuration) */}
      {cfg.enabled && usage && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{tr("审批 Token 消耗", "Approval token usage")}</p>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "模型兜底审批累计用量,单独计量(worker=judge),不与各模型配置的统计混在一起",
                    "Cumulative usage of model fallback approval, metered separately (worker=judge) and not mixed into per-LLM-profile stats",
                  )}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadUsage}>
                {tr("刷新", "Refresh")}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <JudgeStat label={tr("审批调用", "Approval calls")} value={usage.calls.toLocaleString(intlLocale())} />
              <JudgeStat label={tr("输入 Token", "Input tokens")} value={fmtTokens(usage.input_tokens)} />
              <JudgeStat label={tr("输出 Token", "Output tokens")} value={fmtTokens(usage.output_tokens)} />
              <JudgeStat label={tr("缓存读", "Cache read")} value={fmtTokens(usage.cache_read_tokens)} />
              <JudgeStat label={tr("缓存写", "Cache write")} value={fmtTokens(usage.cache_write_tokens)} />
            </div>
            {usage.daily.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {tr("近 30 天每日消耗(输入 + 输出)", "Daily usage, last 30 days (input + output)")}
                </p>
                <JudgeSparkbars daily={usage.daily} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {cfg.enabled && (
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Left: prompt editor (expanded directly, main area) */}
          <Card className="lg:col-span-3">
            <CardContent className="flex h-full flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{tr("审批提示词", "Approval prompt")}</p>
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "模型据此判定 ALLOW / ASK / DENY，可直接编辑",
                      "The model uses this to decide ALLOW / ASK / DENY. Edit it directly",
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={restorePrompt} disabled={saving}>
                  {tr("恢复默认模板", "Restore default template")}
                </Button>
              </div>
              <Textarea
                className="min-h-[22rem] flex-1 resize-none font-mono text-xs leading-relaxed"
                value={cfg.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
                placeholder={tr("留空使用内置模板", "Leave empty to use the built-in template")}
                spellCheck={false}
              />
              <p className="text-right text-[11px] text-muted-foreground">
                {tr(`${cfg.prompt.length} 字`, `${cfg.prompt.length} chars`)}
              </p>
            </CardContent>
          </Card>

          {/* Right: verdict parameters (settings column) */}
          <Card className="lg:col-span-2">
            <CardContent className="space-y-5 p-4">
              <div className="space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tr("判定模型与策略", "Judge model and policy")}
                </p>
                <Field label={tr("审批模型", "Approval model")}>
                  <Select value={String(cfg.profile_id || 0)} onValueChange={(v) => patch({ profile_id: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FOLLOW_ACTIVE}>{tr("跟随激活配置", "Follow active profile")}</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {tr(`${p.name}（${p.model}）`, `${p.name} (${p.model})`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={tr("模型判定超时（秒）", "Model judge timeout (s)")}>
                  <Input
                    type="number"
                    min={1}
                    value={cfg.timeout_seconds}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (n > 0) patch({ timeout_seconds: n });
                    }}
                  />
                </Field>
                <Field
                  label={tr(
                    "模型失败时（出错 / 超时 / 无法解析）",
                    "When the model fails (error / timeout / unparsable)",
                  )}
                >
                  <Select
                    value={cfg.fail_action}
                    onValueChange={(v) => patch({ fail_action: v as JudgeConfig["fail_action"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allow">{tr("放行", "Allow")}</SelectItem>
                      <SelectItem value="ask">{tr("转人工审批", "Hand to human approval")}</SelectItem>
                      <SelectItem value="deny">{tr("拦截", "Block")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Separator />

              <div className="space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tr("人工审批（模型判为「转人工」时）", 'Human approval (when the model says "hand to human")')}
                </p>
                <Field label={tr("审批等待超时（秒）", "Approval wait timeout (s)")}>
                  <Input
                    type="number"
                    min={5}
                    value={cfg.ask_timeout_seconds}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (n > 0) patch({ ask_timeout_seconds: n });
                    }}
                  />
                </Field>
                <Field label={tr("超时后默认动作", "Default action on timeout")}>
                  <Select
                    value={cfg.ask_timeout_action}
                    onValueChange={(v) => patch({ ask_timeout_action: v as JudgeConfig["ask_timeout_action"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deny">{tr("拦截", "Block")}</SelectItem>
                      <SelectItem value="allow">{tr("放行", "Allow")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving || loading}>
          {saving ? tr("保存中…", "Saving…") : tr("保存配置", "Save config")}
        </Button>
      </div>
    </div>
  );
}

// ---- page ----

export default function InterceptPage() {
  const [rules, setRules] = React.useState<InterceptRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<InterceptRule | null>(null);
  const [form, setForm] = React.useState<RuleForm>(defaultForm());
  const [saving, setSaving] = React.useState(false);
  const [regexErr, setRegexErr] = React.useState("");
  const [regexWarn, setRegexWarn] = React.useState(false); // true = JS can't parse it but it may be valid Go syntax

  // ---- tool scope dialog ----
  const [scopeOpen, setScopeOpen] = React.useState(false);
  const [allTools, setAllTools] = React.useState<Tool[]>([]);
  const [enabledTools, setEnabledTools] = React.useState<Set<string>>(new Set());
  const [scopeLoading, setScopeLoading] = React.useState(false);
  const [scopeSaving, setScopeSaving] = React.useState(false);
  const [scopeTools, setScopeTools] = React.useState<string[]>([]); // header info bar: tools currently subject to interception

  // ---- data ----

  const loadScope = React.useCallback(async () => {
    try {
      const cfg = await api.interceptGetToolConfig();
      setScopeTools(cfg.enabled_tools);
    } catch {
      // The info bar is non-critical; fail silently
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      const r = await api.interceptRules();
      setRules(r);
    } catch {
      toast.error(tr("加载拦截规则失败", "Failed to load intercept rules"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    loadScope();
  }, [load, loadScope]);

  React.useEffect(() => {
    if (form.match_type !== "regex" || !form.pattern) {
      setRegexErr("");
      setRegexWarn(false);
      return;
    }
    try {
      new RegExp(form.pattern);
      setRegexErr("");
      setRegexWarn(false);
    } catch {
      // JS RegExp doesn't support Go RE2 extended syntax (e.g. the (?i) inline flag).
      // This only means the preview check failed, not that it is invalid on the Go side; the server does the final validation.
      setRegexErr("");
      setRegexWarn(true);
    }
  }, [form.pattern, form.match_type]);

  // ---- rule handlers ----

  function set(patch: Partial<RuleForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function openNew() {
    setEditing(null);
    setForm(defaultForm());
    setRegexErr("");
    setOpen(true);
  }

  function openEdit(rule: InterceptRule) {
    setEditing(rule);
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      match_target: rule.match_target,
      match_type: rule.match_type,
      pattern: rule.pattern,
      action: rule.action,
      message: rule.message,
      timeout_enabled: rule.timeout_enabled,
      timeout_seconds: rule.timeout_seconds,
      timeout_action: rule.timeout_action,
    });
    setRegexErr("");
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error(tr("名称不能为空", "Name is required"));
      return;
    }
    if (!form.pattern.trim()) {
      toast.error(tr("模式不能为空", "Pattern is required"));
      return;
    }
    if (regexErr) {
      toast.error(tr("正则表达式语法无效", "Invalid regular expression"));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateInterceptRule(editing.id, form);
        toast.success(tr("规则已更新", "Rule updated"));
      } else {
        await api.createInterceptRule(form);
        toast.success(tr("规则已创建", "Rule created"));
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteInterceptRule(id);
      toast.success(tr("规则已删除", "Rule deleted"));
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleToggle(rule: InterceptRule) {
    try {
      await api.toggleInterceptRule(rule.id, !rule.enabled);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // ---- scope handlers ----

  async function openScope() {
    setScopeOpen(true);
    setScopeLoading(true);
    try {
      const [tools, cfg] = await Promise.all([api.tools(), api.interceptGetToolConfig()]);
      setAllTools(tools);
      setEnabledTools(new Set(cfg.enabled_tools));
    } catch (e) {
      toast.error(tr("加载失败: ", "Load failed: ") + (e as Error).message);
    } finally {
      setScopeLoading(false);
    }
  }

  function toggleTool(key: string, val: boolean) {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (val) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function saveScope() {
    setScopeSaving(true);
    try {
      await api.interceptSetToolConfig([...enabledTools]);
      toast.success(tr("拦截范围已保存", "Intercept scope saved"));
      setScopeTools([...enabledTools]);
      setScopeOpen(false);
    } catch (e) {
      toast.error(tr("保存失败: ", "Save failed: ") + (e as Error).message);
    } finally {
      setScopeSaving(false);
    }
  }

  const toolGroups = React.useMemo(() => groupTools(allTools), [allTools]);

  // ---- render ----

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      {/* ---- header ---- */}
      <div className="flex items-center gap-2.5">
        <ShieldAlertIcon className="h-5 w-5 shrink-0" />
        <div>
          <h1 className="text-lg font-semibold leading-tight">{tr("命令拦截", "Command interception")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tr(
              "工具执行前先按拦截规则匹配；未命中的命令可交由模型兜底判定",
              "Tool calls are matched against intercept rules before they run; unmatched commands can fall back to a model judgment",
            )}
          </p>
        </div>
      </div>

      {/* ---- Intercept scope info bar (shared by rule matching and the model fallback: neither steps in for tools outside the scope) ---- */}
      <div
        className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 ${
          scopeTools.length === 0 ? "border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20" : "bg-muted/40"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <ListFilterIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">{tr("拦截范围", "Intercept scope")}</span>
          {scopeTools.length === 0 ? (
            <span className="text-amber-700 dark:text-amber-500">
              {tr(
                "未启用任何工具 — 拦截规则与模型兜底均不会生效",
                "No tools enabled: neither intercept rules nor the model fallback will apply",
              )}
            </span>
          ) : (
            <>
              <Badge variant="secondary" className="shrink-0">
                {tr(`${scopeTools.length} 个工具`, `${scopeTools.length} tool${scopeTools.length === 1 ? "" : "s"}`)}
              </Badge>
              <span className="truncate text-muted-foreground" title={scopeTools.join(tr("、", ", "))}>
                {scopeTools.join(tr("、", ", "))}
              </span>
            </>
          )}
        </div>
        <Button
          variant={scopeTools.length === 0 ? "default" : "outline"}
          size="sm"
          className="shrink-0"
          onClick={openScope}
        >
          <ListFilterIcon className="h-4 w-4" />
          {tr("调整范围", "Edit scope")}
        </Button>
      </div>

      <Tabs defaultValue="rules" className="flex-1">
        <TabsList>
          <TabsTrigger value="rules">{tr("拦截规则", "Intercept rules")}</TabsTrigger>
          <TabsTrigger value="judge">{tr("模型配置", "Model judge")}</TabsTrigger>
        </TabsList>

        {/* ---- tab: intercept rules ---- */}
        <TabsContent value="rules" className="mt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {tr(
                "按优先级（数字越大越先）逐条匹配，首条命中的规则生效",
                "Rules are matched in priority order (higher first); the first match wins",
              )}
            </p>
            <Button onClick={openNew} size="sm" className="shrink-0">
              <PlusIcon className="h-4 w-4" />
              {tr("新建规则", "New rule")}
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">{tr("加载中…", "Loading…")}</p>
              ) : rules.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <ShieldAlertIcon className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{tr("暂无规则", "No rules yet")}</p>
                  <Button size="sm" variant="outline" onClick={openNew}>
                    <PlusIcon className="h-4 w-4" />
                    {tr("新建第一条规则", "Create the first rule")}
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[72px]">{tr("优先级", "Priority")}</TableHead>
                      <TableHead>{tr("名称", "Name")}</TableHead>
                      <TableHead className="w-[90px]">{tr("目标", "Target")}</TableHead>
                      <TableHead className="w-[80px]">{tr("类型", "Type")}</TableHead>
                      <TableHead>{tr("模式", "Pattern")}</TableHead>
                      <TableHead className="w-[72px]">{tr("策略", "Action")}</TableHead>
                      <TableHead className="w-[64px] text-center">{tr("启用", "Enabled")}</TableHead>
                      <TableHead className="w-[80px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.id} className={!rule.enabled ? "opacity-40" : ""}>
                        <TableCell>
                          <span className="font-mono text-xs tabular-nums">{rule.priority}</span>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{rule.name}</TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {rule.match_target === "tool_name" ? tr("工具名", "Tool name") : tr("输入内容", "Input")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {rule.match_type === "regex" ? tr("正则", "Regex") : tr("字符串", "String")}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {rule.pattern}
                          </code>
                        </TableCell>
                        <TableCell>
                          <ActionBadge action={rule.action} />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch checked={rule.enabled} onCheckedChange={() => handleToggle(rule)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(rule)}>
                              <PencilIcon className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(rule.id)}
                            >
                              <Trash2Icon className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- tab: model configuration ---- */}
        <TabsContent value="judge" className="mt-4">
          <JudgeCard />
        </TabsContent>
      </Tabs>

      {/* ---- editor sheet ---- */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{editing ? tr("编辑规则", "Edit rule") : tr("新建规则", "New rule")}</SheetTitle>
            <SheetDescription className="text-xs">
              {tr(
                "优先级越大越先匹配；首条命中规则生效，后续跳过",
                "Higher priority matches first; the first matching rule wins and the rest are skipped",
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
            <Field label={tr("名称", "Name")}>
              <Input
                placeholder={tr("给规则起个名字", "Give the rule a name")}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>

            <Field label={tr("优先级（数字越大越先匹配）", "Priority (higher matches first)")}>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => set({ priority: parseInt(e.target.value) || 0 })}
              />
            </Field>

            <Separator />

            <Field label={tr("匹配目标", "Match target")}>
              <Select
                value={form.match_target}
                onValueChange={(v) => set({ match_target: v as RuleForm["match_target"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tool_name">{tr("工具名（tool_name）", "Tool name (tool_name)")}</SelectItem>
                  <SelectItem value="tool_input">
                    {tr("输入内容（tool_input JSON）", "Input (tool_input JSON)")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label={tr("匹配类型", "Match type")}>
              <Select value={form.match_type} onValueChange={(v) => set({ match_type: v as RuleForm["match_type"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">{tr("字符串包含", "Contains string")}</SelectItem>
                  <SelectItem value="regex">{tr("正则表达式", "Regular expression")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label={tr("模式", "Pattern")}>
              <Input
                placeholder={form.match_type === "regex" ? "^Bash$" : "rm -rf"}
                value={form.pattern}
                onChange={(e) => set({ pattern: e.target.value })}
                className={regexErr ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {regexErr && <p className="text-xs text-destructive mt-1">{regexErr}</p>}
              {regexWarn && (
                <p className="text-xs text-amber-600 mt-1">
                  {tr("包含 Go RE2 扩展语法（如 ", "Contains Go RE2 extended syntax (e.g. ")}
                  <code className="font-mono">(?i)</code>
                  {tr(
                    "），浏览器无法预览，提交后由服务端验证",
                    "), which the browser cannot preview; the server validates it on submit",
                  )}
                </p>
              )}
            </Field>

            <Separator />

            <Field label={tr("拦截策略", "Intercept action")}>
              <Select value={form.action} onValueChange={(v) => set({ action: v as InterceptAction })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">
                    {tr("允许 — 直接放行，跳过后续规则", "Allow: let it through and skip later rules")}
                  </SelectItem>
                  <SelectItem value="deny">
                    {tr("禁止 — 阻断，返回拒绝消息给模型", "Deny: block and return a denial message to the model")}
                  </SelectItem>
                  <SelectItem value="ask">{tr("向用户申请 — 等待审批", "Ask the user: wait for approval")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {form.action !== "allow" && (
              <Field
                label={
                  form.action === "deny"
                    ? tr("拒绝消息（返回给模型）", "Denial message (returned to the model)")
                    : tr("审批说明（可选）", "Approval note (optional)")
                }
              >
                <Textarea
                  placeholder={form.action === "deny" ? tr("操作被安全策略阻止", "Blocked by security policy") : ""}
                  value={form.message}
                  onChange={(e) => set({ message: e.target.value })}
                  rows={2}
                  className="resize-none"
                />
              </Field>
            )}

            {form.action === "ask" && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{tr("启用审批超时", "Approval timeout")}</p>
                    <p className="text-xs text-muted-foreground">
                      {tr("超时后自动处置，不再等待", "Resolve automatically after the timeout instead of waiting")}
                    </p>
                  </div>
                  <Switch checked={form.timeout_enabled} onCheckedChange={(v) => set({ timeout_enabled: v })} />
                </div>
                {form.timeout_enabled && (
                  <div className="flex items-end gap-3">
                    <Field label={tr("超时时间（秒）", "Timeout (s)")}>
                      <Input
                        type="number"
                        min={5}
                        className="w-28"
                        value={form.timeout_seconds}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (n > 0) set({ timeout_seconds: n });
                        }}
                      />
                    </Field>
                    <Field label={tr("超时动作", "Timeout action")}>
                      <Select
                        value={form.timeout_action}
                        onValueChange={(v) => set({ timeout_action: v as "deny" | "allow" })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deny">{tr("自动拒绝", "Auto-deny")}</SelectItem>
                          <SelectItem value="allow">{tr("自动允许", "Auto-allow")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                )}
              </>
            )}

            <Separator />

            <div className="flex items-center gap-3">
              <Switch id="rule-enabled" checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
              <Label htmlFor="rule-enabled" className="cursor-pointer">
                {tr("启用此规则", "Enable this rule")}
              </Label>
            </div>
          </div>

          <SheetFooter className="border-t px-6 py-4 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("取消", "Cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving || !!regexErr}>
              {saving ? tr("保存中…", "Saving…") : tr("保存", "Save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ---- scope dialog ---- */}
      <Dialog open={scopeOpen} onOpenChange={setScopeOpen}>
        <DialogContent
          className="sm:max-w-lg flex flex-col overflow-hidden p-0 gap-0"
          style={{ maxHeight: "min(80vh, 560px)" }}
        >
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <ListFilterIcon className="h-4 w-4" />
              {tr("拦截范围", "Intercept scope")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {tr(
                "只有启用拦截的工具才会进入规则匹配；其余工具直接放行",
                "Only tools with interception enabled go through rule matching; all other tools pass straight through",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-5">
            {scopeLoading ? (
              <p className="text-sm text-muted-foreground py-4">{tr("加载中…", "Loading…")}</p>
            ) : (
              toolGroups.map((group, gi) => (
                <div key={group.label}>
                  {gi > 0 && <Separator className="mb-5" />}
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.tools.map((t) => (
                      <div key={t.key} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                        <Switch
                          id={`scope-${t.key}`}
                          checked={enabledTools.has(t.key)}
                          onCheckedChange={(v) => toggleTool(t.key, v)}
                        />
                        <label htmlFor={`scope-${t.key}`} className="flex-1 min-w-0 cursor-pointer">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm">{t.key}</span>
                            {t.kind && t.kind !== "builtin" && (
                              <Badge variant="outline" className="px-1 py-0 text-[10px]">
                                {t.kind}
                              </Badge>
                            )}
                          </div>
                          {t.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1">{t.description}</p>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="shrink-0 border-t px-6 py-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setScopeOpen(false)}>
              {tr("取消", "Cancel")}
            </Button>
            <Button size="sm" onClick={saveScope} disabled={scopeSaving || scopeLoading}>
              {scopeSaving ? tr("保存中…", "Saving…") : tr("保存", "Save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
