"use client";

import * as React from "react";

import {
  Loader2Icon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  StarIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { LLMPoolMember, LLMPoolStatus, LLMProfile, LLMRetryOverride } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProfileRetryFields, RetryPolicyPanel, ZERO_OVERRIDE } from "./_components/retry";

// The thinking switch (thinking.type) and thinking effort (reasoning_effort) are two **mutually independent** fields,
// each set separately -- some endpoints have no thinking field and enable thinking through the effort parameter alone, hence the decoupling.
// An empty string in storage = the field is **not sent**; Radix Select doesn't accept an empty value, so the UI uses a "none"
// sentinel for "not sent" and converts to/from "" on load/save (NONE / fromStore / toStore).
const NONE = "none";
const fromStore = (v?: string) => (v ? v : NONE);
const toStore = (v: string) => (v === NONE ? "" : v);
const THINKING_TYPES: { value: string; label: string }[] = [
  { value: NONE, label: tr("不发送（默认）", "Not sent (default)") },
  { value: "disabled", label: tr("关闭", "Disabled") },
  { value: "enabled", label: tr("开启", "Enabled") },
];
// Which request field name the output limit uses (only meaningful for the openai format). NONE ↔ "" goes through the same sentinel conversion.
const MAX_TOKENS_FIELDS: { value: string; label: string }[] = [
  { value: NONE, label: tr("max_tokens（默认）", "max_tokens (default)") },
  { value: "max_completion_tokens", label: "max_completion_tokens" },
];
// The other two formats each hard-code their field name, so the option is meaningless for them; the description text says so directly.
const MAX_TOKENS_FIELD_HINTS: Record<string, string> = {
  openai: tr(
    "上限发哪个键。max_tokens 是默认，绝大多数兼容网关只认它；OpenAI 官方推理模型（o 系列 / GPT-5）反过来只认 max_completion_tokens，收到 max_tokens 会直接报 unsupported_parameter。",
    "Which key carries the limit. max_tokens is the default and the only one most compatible gateways accept; OpenAI's own reasoning models (o-series / GPT-5) only accept max_completion_tokens and reject max_tokens with unsupported_parameter.",
  ),
  anthropic: tr(
    "仅 openai 格式可选。Anthropic 的字段名固定为 max_tokens。",
    "Only selectable for the openai format. Anthropic always uses max_tokens.",
  ),
  "openai-responses": tr(
    "仅 openai 格式可选。Responses API 的字段名固定为 max_output_tokens。",
    "Only selectable for the openai format. The Responses API always uses max_output_tokens.",
  ),
};
const EFFORT_LEVELS: { value: string; label: string }[] = [
  { value: NONE, label: tr("不发送（默认）", "Not sent (default)") },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

function cooldownText(secs: number) {
  if (secs <= 0) return "";
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}min`;
}

// The "healthy or not" a profile shows on its card. A profile without a Key can't send requests at all, which matters more than a tripped breaker;
// the other states come from the pool's circuit-breaker records (with the pool off no new records appear, so "Healthy" = no known failure).
type Health = { label: string; cls: string; hint?: string };
function healthOf(p: LLMProfile, m?: LLMPoolMember): Health {
  if (!p.api_key_hint) {
    return {
      label: tr("未配置 Key", "No key"),
      cls: "border-muted-foreground/40 text-muted-foreground",
      hint: tr("未填 API Key，无法调用", "No API key set, cannot make calls"),
    };
  }
  if (m?.state === "tripped") {
    return {
      label:
        m.cooldown_secs > 0
          ? tr(`已熔断 · ${cooldownText(m.cooldown_secs)}`, `Tripped · ${cooldownText(m.cooldown_secs)}`)
          : tr("已熔断", "Tripped"),
      cls: "border-destructive/50 text-destructive",
      hint: m.last_error,
    };
  }
  if (m?.state === "degraded") {
    return {
      label: tr(`异常 · 失败 ${m.fails} 次`, `Degraded · ${m.fails} failures`),
      cls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
      hint: m.last_error,
    };
  }
  return { label: tr("正常", "Healthy"), cls: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool configuration drawer
// ─────────────────────────────────────────────────────────────────────────────

function PoolSheet({
  open,
  onOpenChange,
  pool,
  onReload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pool: LLMPoolStatus | null;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  // The cooldown countdown is the remaining seconds computed by the backend -- poll on a timer only while the drawer is open and some profile is unhealthy, so it ticks.
  React.useEffect(() => {
    if (!open || !pool?.enabled || !pool.chain.some((m) => m.state !== "ok")) return;
    const t = setInterval(() => void onReload(), 10_000);
    return () => clearInterval(t);
  }, [open, pool, onReload]);

  async function toggle(patch: { llm_pool_enabled?: boolean; llm_pool_bind_fallback?: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setSettings(patch);
      await onReload();
      if (patch.llm_pool_enabled !== undefined) {
        toast.success(
          patch.llm_pool_enabled
            ? tr("已开启 LLM 轮询", "LLM rotation enabled")
            : tr("已关闭 LLM 轮询", "LLM rotation disabled"),
        );
      } else {
        toast.success(tr("已更新兜底设置", "Fallback setting updated"));
      }
    } catch (e) {
      toast.error(tr(`设置失败：${(e as Error).message}`, `Update failed: ${(e as Error).message}`));
    } finally {
      setBusy(false);
    }
  }

  async function recover(id?: string) {
    try {
      await api.resetLLMPool(id);
      await onReload();
      toast.success(id ? tr("已恢复该配置", "Profile restored") : tr("已恢复全部配置", "All profiles restored"));
    } catch (e) {
      toast.error(tr(`恢复失败：${(e as Error).message}`, `Restore failed: ${(e as Error).message}`));
    }
  }

  const enabled = pool?.enabled ?? false;
  const chain = pool?.chain ?? [];
  // Pool members (excluding those marked "not in pool"); the order is the backend's actual try order.
  const inChain = chain.filter((m) => m.active || !m.excluded);
  const tripped = chain.filter((m) => m.state === "tripped");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            <ZapIcon className="size-4" /> {tr("LLM 轮询 · 故障转移", "LLM rotation · failover")}
          </SheetTitle>
          <SheetDescription>
            {tr("开启后，", "When enabled, Agents ")}
            <b>{tr("未指定模型", "without a pinned model")}</b>
            {tr(
              "的 Agent 在当前配置不可用（余额不足 / Key 失效 / 限流 / 服务异常）时自动切到下一个配置。",
              " automatically switch to the next profile when the current one is unavailable (insufficient balance / invalid key / rate limited / service error).",
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label className="text-sm">{tr("启用轮询", "Enable rotation")}</Label>
              <p className="text-muted-foreground text-xs">
                {tr(
                  "默认关闭。关闭时始终只用激活配置，失败即失败。",
                  "Off by default. When off, only the active profile is used and a failure is final.",
                )}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggle({ llm_pool_enabled: v })}
              aria-label={tr("LLM 轮询开关", "LLM rotation switch")}
            />
          </div>

          {enabled && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label className="text-sm">{tr("指定模型失败时也兜底", "Fall back for pinned models too")}</Label>
                  <p className="text-muted-foreground text-xs">
                    {tr(
                      "默认关闭：Agent 或任务指定了某个配置就只用它，失败即失败（不会悄悄换成别的模型）。开启后，指定的配置失败时也会回落到下面的轮询链。",
                      "Off by default: an Agent or task pinned to a profile uses only that profile and a failure is final (it never silently switches models). When on, a failing pinned profile also falls back to the rotation chain below.",
                    )}
                  </p>
                </div>
                <Switch
                  checked={pool?.bind_fallback ?? false}
                  disabled={busy}
                  onCheckedChange={(v) => void toggle({ llm_pool_bind_fallback: v })}
                  aria-label={tr("绑定配置失败兜底开关", "Pinned profile fallback switch")}
                />
              </div>

              <Separator />

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{tr("轮询顺序", "Rotation order")}</Label>
                  {tripped.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => void recover()}>
                      <RotateCcwIcon /> {tr("全部恢复", "Restore all")}
                    </Button>
                  )}
                </div>
                {inChain.length < 2 && (
                  <p className="text-muted-foreground text-xs">
                    {tr(
                      `当前只有 ${inChain.length} 个可用配置，轮询不会生效——至少需要 2 个已填 API Key 且参与轮询的配置。`,
                      `Only ${inChain.length} usable profile(s), so rotation has no effect. At least 2 profiles with an API key that take part in rotation are needed.`,
                    )}
                  </p>
                )}
                {chain.map((m) => {
                  const excluded = m.excluded && !m.active;
                  const order = excluded ? null : inChain.findIndex((x) => x.profile_id === m.profile_id) + 1;
                  return (
                    <div
                      key={m.profile_id}
                      className={cn(
                        "grid gap-1 rounded-lg border p-2.5 text-sm",
                        excluded && "opacity-55",
                        m.state === "tripped" && "border-destructive/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="w-5 shrink-0 text-center font-mono text-muted-foreground text-xs">
                          {order ?? "—"}
                        </span>
                        <span className="font-medium">{m.name}</span>
                        {m.active && (
                          <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                            {tr("激活", "Active")}
                          </Badge>
                        )}
                        {excluded && <Badge variant="outline">{tr("不参与轮询", "Excluded from rotation")}</Badge>}
                        <div className="ml-auto flex items-center gap-2">
                          {m.state === "tripped" && m.cooldown_secs > 0 && (
                            <span className="text-muted-foreground text-xs">
                              {tr("冷却", "Cooldown")} {cooldownText(m.cooldown_secs)}
                            </span>
                          )}
                          {m.state === "degraded" && (
                            <span className="text-muted-foreground text-xs">
                              {tr(`连续失败 ${m.fails} 次`, `${m.fails} consecutive failures`)}
                            </span>
                          )}
                          {m.state !== "ok" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label={tr("立即恢复", "Restore now")}
                              title={tr(
                                "立即恢复：清除熔断，下次调用重试该配置",
                                "Restore now: clear the breaker so the next call retries this profile",
                              )}
                              onClick={() => void recover(m.profile_id)}
                            >
                              <RotateCcwIcon className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 pl-7 text-muted-foreground text-xs">
                        <code className="truncate font-mono">{m.model}</code>
                        {!m.active && (
                          <span>
                            {tr("优先级", "Priority")} {m.priority}
                          </span>
                        )}
                      </div>
                      {m.last_error && (
                        <p className="truncate pl-7 font-mono text-muted-foreground text-xs" title={m.last_error}>
                          {m.last_error}
                        </p>
                      )}
                    </div>
                  );
                })}
                {chain.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
                    {tr("暂无配置", "No profiles yet")}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs leading-relaxed">
                {tr(
                  "激活配置恒为第 1 顺位，其余按优先级从高到低（在各配置里设置）。某个配置失败后进入冷却 （60s → 5min → 30min），冷却期内被跳过，恢复后自动切回。上下文窗口装不下当前请求的配置会被跳过。 指定了模型的 Agent 与任务默认不参与轮询。",
                  "The active profile is always first; the rest follow by priority, highest first (set in each profile). A failing profile enters a cooldown (60s → 5min → 30min), is skipped during it, and is switched back to once it recovers. Profiles whose context window cannot fit the current request are skipped. Agents and tasks with a pinned model do not take part in rotation by default.",
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model profile drawer (create / edit share the same form)
// ─────────────────────────────────────────────────────────────────────────────

function ProfileSheet({
  profile,
  open,
  onOpenChange,
  onSaved,
}: {
  profile: LLMProfile | null; // null = create
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const isNew = !profile;
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<"anthropic" | "openai" | "openai-responses">("anthropic");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [proxy, setProxy] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [keyHint, setKeyHint] = React.useState("");
  const [rps, setRps] = React.useState("0");
  const [rpm, setRpm] = React.useState("0");
  const [cw, setCw] = React.useState("0"); // context window (K tokens); 0 = default 200K
  const [thinkingType, setThinkingType] = React.useState(NONE);
  const [effort, setEffort] = React.useState(NONE);
  const [priority, setPriority] = React.useState("0"); // pool order; higher goes first
  const [poolExclude, setPoolExclude] = React.useState(false);
  const [streaming, setStreaming] = React.useState(true); // true = streaming (default); false = non-streaming
  const [maxTokens, setMaxTokens] = React.useState("0"); // output limit per reply; 0 = not sent
  const [maxTokensField, setMaxTokensField] = React.useState(NONE); // field name for the limit; NONE = max_tokens
  const [sessionHeaderKey, setSessionHeaderKey] = React.useState(""); // custom session header name; empty = not sent
  const [retry, setRetry] = React.useState<LLMRetryOverride>(ZERO_OVERRIDE); // this profile's retry overrides; all 0 = follow global
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [models, setModels] = React.useState<string[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsOpen, setModelsOpen] = React.useState(false);

  // Refill the form from the given profile on every open (reset to defaults when creating). Closing and reopening the drawer
  // is a clean start, with no leftovers from the previous profile.
  React.useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setFormat(profile?.format === "openai" || profile?.format === "openai-responses" ? profile.format : "anthropic");
    setModel(profile?.model ?? "");
    setBaseUrl(profile?.base_url ?? "");
    setProxy(profile?.proxy ?? "");
    setRps(String(profile?.rate_per_second ?? 0));
    setRpm(String(profile?.rate_per_minute ?? 0));
    setCw(String(profile?.context_window_k ?? 0));
    setThinkingType(fromStore(profile?.thinking_type));
    setEffort(fromStore(profile?.reasoning_effort));
    setPriority(String(profile?.priority ?? 0));
    setPoolExclude(profile?.pool_exclude ?? false);
    setStreaming(profile?.streaming ?? true);
    setMaxTokens(String(profile?.max_tokens ?? 0));
    setMaxTokensField(fromStore(profile?.max_tokens_field));
    setSessionHeaderKey(profile?.session_header_key ?? "");
    setRetry(profile?.retry ?? ZERO_OVERRIDE);
    setApiKey("");
    setKeyHint(profile?.api_key_hint ?? "");
    setModels([]);
    setModelsOpen(false);
  }, [open, profile]);

  const profileId = profile ? Number(profile.id) : undefined;

  async function loadModels() {
    if (loadingModels) return;
    setLoadingModels(true);
    setModels([]);
    try {
      const r = await api.fetchLLMModels(format, baseUrl, apiKey, proxy, profileId);
      if (r.ok && r.models && r.models.length > 0) {
        setModels(r.models);
        setModelsOpen(true);
        toast.success(tr(`已加载 ${r.models.length} 个模型`, `Loaded ${r.models.length} models`));
      } else {
        const err = r.error ?? tr("未获取到模型", "no models returned");
        toast.error(tr(`加载模型失败：${err}`, `Failed to load models: ${err}`));
      }
    } catch (e) {
      toast.error(tr(`加载模型出错：${(e as Error).message}`, `Error loading models: ${(e as Error).message}`));
    } finally {
      setLoadingModels(false);
    }
  }

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    try {
      // Test with the thinking parameters the profile will actually use, so a model that doesn't support the field fails here
      // instead of blowing up while running a task. Pass the profile id: when the Key input is blank the stored Key is used.
      const r = await api.testLLM(
        format,
        model,
        baseUrl,
        apiKey,
        proxy,
        toStore(thinkingType),
        toStore(effort),
        profileId,
        streaming,
        sessionHeaderKey.trim(),
      );
      // Show the reply content too: only seeing the model actually say something counts as working the same way it does in a conversation.
      if (r.ok)
        toast.success(
          tr(
            `连接成功 · ${r.latency_ms ?? "?"}ms · ${r.model ?? model}`,
            `Connected · ${r.latency_ms ?? "?"}ms · ${r.model ?? model}`,
          ),
          {
            description: r.reply ? tr(`回复：${r.reply}`, `Reply: ${r.reply}`) : undefined,
          },
        );
      else {
        const err = r.error ?? tr("未知", "unknown");
        toast.error(tr(`连接失败：${err}`, `Connection failed: ${err}`));
      }
    } catch (e) {
      toast.error(tr(`测试出错：${(e as Error).message}`, `Test error: ${(e as Error).message}`));
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!name.trim() || !model.trim()) {
      toast.error(tr("请填写名称与模型", "Please enter a name and a model"));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { id } = await api.saveLLMProfile({
        ...(profile ? { id: Number(profile.id) } : {}),
        name: name.trim(),
        format,
        model: model.trim(),
        base_url: baseUrl.trim(),
        proxy: proxy.trim(),
        api_key: apiKey,
        rate_per_second: Number(rps) || 0,
        rate_per_minute: Number(rpm) || 0,
        context_window_k: Number(cw) || 0,
        thinking_type: toStore(thinkingType),
        reasoning_effort: toStore(effort),
        priority: Number(priority) || 0,
        pool_exclude: poolExclude,
        streaming,
        max_tokens: Math.max(0, Number(maxTokens) || 0),
        // The field-name switch only means something for openai (Chat Completions); other formats always fall back to the default;
        // the backend normalizes the same way again, this just keeps the UI from sending self-contradictory values.
        max_tokens_field: format === "openai" ? toStore(maxTokensField) : "",
        session_header_key: sessionHeaderKey.trim(),
        retry,
      });
      if (isNew)
        toast.success(
          tr(
            `已新建：${name.trim()}（在卡片上「设为激活」以启用）`,
            `Created: ${name.trim()} (use "Set active" on its card to enable it)`,
          ),
        );
      else
        toast.success(
          profile?.is_default
            ? tr(
                "已保存，激活配置即时生效，无需重启",
                "Saved. The active profile takes effect immediately, no restart needed",
              )
            : tr("已保存", "Saved"),
        );
      onSaved(String(id));
      onOpenChange(false);
    } catch (e) {
      toast.error(tr(`保存失败：${(e as Error).message}`, `Save failed: ${(e as Error).message}`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:min-w-[420px] data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            {isNew ? tr("新建模型配置", "New LLM profile") : tr(`编辑：${profile?.name}`, `Edit: ${profile?.name}`)}
            {profile?.is_default && (
              <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                {tr("激活中", "Active")}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {isNew
              ? tr(
                  "新建后不会自动激活，请在卡片上「设为激活」以启用。",
                  'New profiles are not activated automatically; use "Set active" on the card to enable it.',
                )
              : tr(
                  "修改后点击保存；激活配置保存后对全部 Agent 立即生效。",
                  "Click Save after editing; changes to the active profile apply to all Agents immediately.",
                )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="p-name">{tr("名称", "Name")}</Label>
              <Input
                id="p-name"
                placeholder={tr("例如：OpenAI 生产", "e.g. OpenAI production")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>{tr("格式", "Format")}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "anthropic" | "openai" | "openai-responses")}>
                <SelectTrigger>
                  <SelectValue placeholder={tr("选择格式", "Select format")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI (Chat Completions)</SelectItem>
                  <SelectItem value="openai-responses">OpenAI (Responses API)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-model">{tr("模型", "Model")}</Label>
            <div className="flex gap-2">
              <Input
                id="p-model"
                className="font-mono"
                placeholder="claude-opus-4-8"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              {/* modal: this Popover's content is portaled to <body>, outside the Sheet's scroll lock;
                  without modal the list renders but can't scroll. modal makes it hold the topmost scroll lock itself. */}
              <Popover open={modelsOpen} onOpenChange={setModelsOpen} modal>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={loadingModels}
                    onClick={loadModels}
                    title={tr("从 API 加载可用模型", "Load available models from the API")}
                  >
                    {loadingModels ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                  </Button>
                </PopoverTrigger>
                {models.length > 0 && (
                  <PopoverContent className="max-h-72 w-72 gap-0 overflow-y-auto overscroll-contain p-1" align="end">
                    {models.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="w-full shrink-0 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          setModel(m);
                          setModelsOpen(false);
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </PopoverContent>
                )}
              </Popover>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-base-url">{tr("Base URL（可选）", "Base URL (optional)")}</Label>
            <Input
              id="p-base-url"
              className="font-mono"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-proxy">{tr("代理（可选）", "Proxy (optional)")}</Label>
            <Input
              id="p-proxy"
              className="font-mono"
              placeholder="socks5://user:pass@127.0.0.1:1080 · http://127.0.0.1:8080"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {tr(
                "仅 LLM 出站请求走此代理，支持 http/https/socks5，可带账号密码（如 socks5://user:pass@host:port，密码含特殊字符需 URL 编码）；留空表示不使用代理（直连）。",
                "Only outbound LLM requests use this proxy. Supports http/https/socks5 with optional credentials (e.g. socks5://user:pass@host:port; URL-encode special characters in the password). Leave empty to connect directly.",
              )}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-session-header">{tr("自定义会话头（可选）", "Custom session header (optional)")}</Label>
            <Input
              id="p-session-header"
              className="font-mono"
              placeholder={tr("如 x-session-id（留空=不发送）", "e.g. x-session-id (empty = not sent)")}
              value={sessionHeaderKey}
              onChange={(e) => setSessionHeaderKey(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {tr(
                "填写头名后，每次请求都会带上这个 HTTP 头，头值自动填为 ",
                "When set, every request carries this HTTP header, with its value set automatically to ",
              )}
              <b>{tr("当前会话的 session id", "the current session id")}</b>
              {tr(
                "（chat 会话如 conv-12、worker 如 exp3-worker-i87）。用于按 session-id 头做提示缓存 / 粘性路由的网关；同一会话多轮稳定、不同会话互不相同。留空则不发送。",
                " (e.g. conv-12 for chat sessions, exp3-worker-i87 for workers). Useful for gateways that do prompt caching / sticky routing by a session-id header; it stays stable across turns of one session and differs between sessions. Leave empty to not send it.",
              )}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-api-key">API Key</Label>
            <Input
              id="p-api-key"
              type="password"
              placeholder={
                keyHint ? tr(`已设置（${keyHint}），留空保持不变`, `Set (${keyHint}); leave empty to keep`) : "sk-…"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-rps">{tr("每秒限速", "Requests / second")}</Label>
              <Input id="p-rps" type="number" min={0} value={rps} onChange={(e) => setRps(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-rpm">{tr("每分钟限速", "Requests / minute")}</Label>
              <Input id="p-rpm" type="number" min={0} value={rpm} onChange={(e) => setRpm(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-cw">{tr("上下文窗口(K)", "Context window (K)")}</Label>
              <Input
                id="p-cw"
                type="number"
                min={0}
                max={1000}
                value={cw}
                onChange={(e) => setCw(e.target.value)}
                placeholder="200"
              />
            </div>
          </div>
          <p className="-mt-2 text-muted-foreground text-xs">
            {tr(
              "限速 0 = 不限，全 Agent 共享。上下文窗口单位 K（千 token），0 = 默认 200K，上限 1000（即 1M）；设太高会导致压缩不触发。",
              "Rate limit 0 = unlimited, shared by all Agents. Context window is in K (thousand tokens); 0 = default 200K, max 1000 (1M). Setting it too high prevents compaction from triggering.",
            )}
          </p>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-priority" className="text-sm">
                  {tr("轮询优先级", "Rotation priority")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "数字越大越先被选中；激活配置恒为第 1 顺位，与本值无关。相同优先级的配置会轮流打头，天然分摊额度。",
                    "Higher numbers are picked first; the active profile is always first regardless of this value. Profiles with equal priority take turns leading, spreading quota naturally.",
                  )}
                </p>
              </div>
              <Input
                id="p-priority"
                type="number"
                className="w-24 shrink-0"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">{tr("不参与轮询", "Exclude from rotation")}</Label>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "开启后不会被当作故障转移目标（仍可被 Agent / 任务显式指定使用）。 适合「只给某个 Agent 专用、不希望别人失败时烧掉」的昂贵配置。",
                    "When on, this profile is never used as a failover target (Agents / tasks can still pin it explicitly). Useful for expensive profiles reserved for one Agent that should not be burned when others fail.",
                  )}
                </p>
              </div>
              <Switch
                checked={poolExclude}
                onCheckedChange={setPoolExclude}
                aria-label={tr("不参与轮询", "Exclude from rotation")}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">{tr("流式输出 · streaming", "Streaming output")}</Label>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "开启（默认）走流式 SSE，有运行中实时进度与实时 token 计数。 关闭则走真·非流式（stream:false，一次性返回完整响应）——可绕开部分网关糟糕的 SSE 实现（空帧 / 思考字段丢帧），代价是失去运行中的实时进度。",
                    "On (default) uses streaming SSE with live progress and live token counts. Off uses true non-streaming (stream:false, the full response at once), which works around some gateways' broken SSE (empty frames / dropped thinking frames) at the cost of live progress.",
                  )}
                </p>
              </div>
              <Switch
                checked={streaming}
                onCheckedChange={setStreaming}
                aria-label={tr("流式输出", "Streaming output")}
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-max-tokens" className="text-sm">
                  {tr("输出上限 · max tokens", "Output limit · max tokens")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "单次回复最多生成多少 token，随每次请求发出。0（默认）= 不发送该字段，由服务端默认值决定。这与上面的「上下文窗口」是两回事：那是模型总容量，只在本地用来算压缩阈值。设太小会让推理模型在思考阶段就被截断，一个字答案都出不来。",
                    'Maximum tokens generated per reply, sent with every request. 0 (default) = field not sent, the server default applies. This is unrelated to the "Context window" above, which is the model\'s total capacity and is only used locally to compute the compaction threshold. Setting it too low can cut reasoning models off while thinking, before any answer is produced.',
                  )}
                </p>
              </div>
              <Input
                id="p-max-tokens"
                type="number"
                min={0}
                className="w-28 shrink-0"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">{tr("上限字段名", "Limit field name")}</Label>
                <p className="text-muted-foreground text-xs">{MAX_TOKENS_FIELD_HINTS[format]}</p>
              </div>
              <Select
                value={format === "openai" ? maxTokensField : NONE}
                onValueChange={setMaxTokensField}
                disabled={format !== "openai"}
              >
                <SelectTrigger className="w-56 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_TOKENS_FIELDS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label className="text-sm">{tr("思考开关 · thinking.type", "Thinking · thinking.type")}</Label>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "控制是否发送 thinking 字段。不发送=不带该字段（兼容 MiniMax 等不支持 的模型）；关闭=发 disabled；开启=发 enabled。与下面的强度互相独立。",
                    "Controls whether the thinking field is sent. Not sent = field omitted (for models like MiniMax that do not support it); Disabled = sends disabled; Enabled = sends enabled. Independent of the effort below.",
                  )}
                </p>
              </div>
              <Select value={thinkingType} onValueChange={setThinkingType}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_TYPES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">
                  {tr("思考强度 · reasoning_effort", "Reasoning effort · reasoning_effort")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "独立的强度档位（OpenAI reasoning_effort / Anthropic output_config.effort）。 有些接口没有 thinking 字段、只靠强度即可激活思考，故可单独设置、不发送思考开关。",
                    "A separate effort level (OpenAI reasoning_effort / Anthropic output_config.effort). Some APIs have no thinking field and enable thinking through effort alone, so it can be set on its own without sending the thinking switch.",
                  )}
                </p>
              </div>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EFFORT_LEVELS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ProfileRetryFields value={retry} onChange={setRetry} />
        </div>

        <div className="flex gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            {testing ? tr("测试中…", "Testing…") : tr("测试连接", "Test connection")}
          </Button>
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving && <Loader2Icon className="animate-spin" />}
            {!saving && (isNew ? <PlusIcon /> : <SaveIcon />)}
            {isNew ? tr("新建", "Create") : tr("保存", "Save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LLMPage() {
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [pool, setPool] = React.useState<LLMPoolStatus | null>(null);
  const [poolOpen, setPoolOpen] = React.useState(false);
  // The drawer's open state and content are stored separately: editing stays unchanged on close, otherwise during the close animation the title would flash from
  // "Edit X" to "New". editing = null means create.
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LLMProfile | null>(null);
  const openEditor = React.useCallback((p: LLMProfile | null) => {
    setEditing(p);
    setEditOpen(true);
  }, []);

  const loadPool = React.useCallback(async () => {
    try {
      setPool(await api.llmPool());
    } catch {
      /* ignore */
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      setProfiles(await api.llmProfiles());
    } catch {
      /* ignore */
    }
    await loadPool();
  }, [loadPool]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // The health badge on a card takes the pool status by profile id.
  const health = React.useMemo(() => {
    const m = new Map<string, LLMPoolMember>();
    for (const c of pool?.chain ?? []) m.set(c.profile_id, c);
    return m;
  }, [pool]);

  async function activate(id: string, name: string) {
    try {
      await api.activateLLMProfile(id);
      toast.success(tr(`已激活：${name}`, `Activated: ${name}`));
      await load();
    } catch (e) {
      toast.error(tr(`激活失败：${(e as Error).message}`, `Activation failed: ${(e as Error).message}`));
    }
  }

  async function remove(p: LLMProfile) {
    if (p.is_default) {
      toast.error(tr("无法删除当前激活的配置", "The active profile cannot be deleted"));
      return;
    }
    try {
      await api.deleteLLMProfile(p.id);
      toast.success(tr(`已删除：${p.name}`, `Deleted: ${p.name}`));
      await load();
    } catch (e) {
      toast.error(tr(`删除失败：${(e as Error).message}`, `Delete failed: ${(e as Error).message}`));
    }
  }

  const poolOn = pool?.enabled ?? false;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">LLM</h1>
          <p className="text-muted-foreground text-sm">
            {tr(
              "全 Agent 共享的格式 / 模型 / 限速配置。点击卡片编辑，星标为当前激活配置。",
              "Format / model / rate-limit profiles shared by all Agents. Click a card to edit; the star marks the active profile.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPoolOpen(true)}>
            <ZapIcon /> {tr("轮询配置", "Rotation")}
            {poolOn && (
              <Badge variant="outline" className="ml-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
                {tr("已开启", "On")}
              </Badge>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEditor(null)}>
            <PlusIcon /> {tr("新建", "New")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="profiles" className="flex-1">
        <TabsList>
          <TabsTrigger value="profiles">{tr("模型配置", "LLM profiles")}</TabsTrigger>
          <TabsTrigger value="retry">{tr("重试与退避", "Retry & backoff")}</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => {
              const h = healthOf(p, health.get(p.id));
              return (
                // biome-ignore lint/a11y/useSemanticElements: the card contains its own action buttons; a native <button> would nest buttons (invalid HTML)
                <Card
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditor(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEditor(p);
                    }
                  }}
                  className={cn(
                    "cursor-pointer gap-0 py-4 outline-none transition-colors hover:border-foreground/30",
                    p.is_default && "border-amber-400/50 bg-amber-400/5",
                  )}
                >
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex items-start gap-2">
                      <StarIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          p.is_default ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">{p.name}</span>
                          <Badge variant="outline" className="uppercase">
                            {p.format}
                          </Badge>
                          <Badge variant="outline" className={cn("ml-auto", h.cls)} title={h.hint}>
                            {h.label}
                          </Badge>
                        </div>
                        <code className="mt-1 block truncate font-mono text-muted-foreground text-xs">{p.model}</code>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-muted-foreground text-xs">
                      {p.api_key_hint && <span>{p.api_key_hint}</span>}
                      <span>
                        {p.rate_per_second}/s · {p.rate_per_minute}/min
                      </span>
                      {p.proxy && (
                        <span className="truncate">
                          {tr("代理", "Proxy")} {p.proxy}
                        </span>
                      )}
                      {p.reasoning_effort && (
                        <span>
                          {tr("思考", "Thinking")} {p.reasoning_effort === "off" ? tr("关", "off") : p.reasoning_effort}
                        </span>
                      )}
                      {/* The two pool-related fields only matter while the pool is on; when it's off they take no space */}
                      {poolOn &&
                        !p.is_default &&
                        (p.pool_exclude ? (
                          <span>{tr("不参与轮询", "Excluded from rotation")}</span>
                        ) : (
                          <span>
                            {tr("优先级", "Priority")} {p.priority ?? 0}
                          </span>
                        ))}
                    </div>

                    <div className="mt-1 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={p.is_default}
                        onClick={(e) => {
                          e.stopPropagation();
                          void activate(p.id, p.name);
                        }}
                      >
                        {p.is_default ? tr("已激活", "Active") : tr("设为激活", "Set active")}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={tr("删除配置", "Delete profile")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(p);
                        }}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {profiles.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-muted-foreground text-sm">
                {tr(
                  "还没有模型配置，点击右上角「新建」创建第一个。",
                  'No LLM profiles yet. Click "New" in the top right to create the first one.',
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="retry" className="mt-4">
          <RetryPolicyPanel />
        </TabsContent>
      </Tabs>

      <ProfileSheet profile={editing} open={editOpen} onOpenChange={setEditOpen} onSaved={() => void load()} />
      <PoolSheet open={poolOpen} onOpenChange={setPoolOpen} pool={pool} onReload={loadPool} />
    </div>
  );
}
