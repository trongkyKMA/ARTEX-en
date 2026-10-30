"use client";

// Shared pieces of the LLM retry configuration: "count + interval" for each of the five retry layers.
//
// The five layers from inside out: connect (SDK) → empty response (SDK) → same-provider safety window → pool circuit breaker → intent rerun.
// The first three follow the endpoint, so every model profile can override the global defaults; the last two are process-level with a single global copy.
//
// Every input follows the same "blank = not configured" semantics, matching the backend db.RetryRule:
//   count      blank/0 = use the built-in default | -1 = disable this retry layer | >0 = use this count
//   interval   blank/0 = use this layer's original exponential backoff | >0 = use this fixed interval in milliseconds instead

import * as React from "react";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { LLMRetryOverride, LLMRetryPolicy, LLMRetryRule } from "@/lib/types";

export const ZERO_RULE: LLMRetryRule = { attempts: 0, interval_ms: 0 };
export const ZERO_OVERRIDE: LLMRetryOverride = {
  connect: ZERO_RULE,
  empty: ZERO_RULE,
  stream: ZERO_RULE,
};
const ZERO_POLICY: LLMRetryPolicy = {
  ...ZERO_OVERRIDE,
  breaker: ZERO_RULE,
  intent: ZERO_RULE,
};

type LayerMeta = {
  title: string;
  /** Where this retry layer happens and who executes it */
  where: string;
  /** What kind of errors reach this layer -- down to the status code, don't make people guess */
  trigger: string;
  /** Errors that look similar but do **not** go through this layer, so nobody fills it in, sees no effect and thinks it's a bug */
  skips?: string;
  desc: string;
  attemptsLabel: string;
  /** Default when the count is blank, used for the placeholder */
  defAttempts: number;
  /** Default strategy when the interval is blank, used for the placeholder */
  defInterval: string;
  /** Meaning of entering -1 as the count */
  offHint: string;
};

export const RETRY_LAYERS = {
  connect: {
    title: tr("建连重试", "Connection retry"),
    where: tr("SDK · 拿到 200 之前", "SDK · before a 200 is received"),
    trigger: tr(
      "连不上或还没拿到 200：连接重置 / 读写超时 / DNS 失败等网络层错误，以及 HTTP 408、429、500、502、503、504。",
      "Cannot connect or no 200 yet: network-level errors such as connection reset / read-write timeout / DNS failure, plus HTTP 408, 429, 500, 502, 503, 504.",
    ),
    skips: tr(
      "其余状态码（400 / 401 / 403 / 404 / 413 / 422 等）都是确定性拒绝，重发也一样失败，直接上抛。",
      "Other status codes (400 / 401 / 403 / 404 / 413 / 422, etc.) are deterministic rejections that would fail again on resend, so they are raised immediately.",
    ),
    desc: tr(
      "原样重发同一个请求。流一旦开始（已经拿到 200），中途断开就不归这层管了。",
      "Resends the same request as-is. Once the stream has started (a 200 was received), mid-stream disconnects are no longer handled by this layer.",
    ),
    attemptsLabel: tr("重试次数", "Retries"),
    defAttempts: 3,
    defInterval: tr("0.5s→1s→2s 指数（封顶 8s）", "0.5s→1s→2s exponential (max 8s)"),
    offHint: tr("-1 = 一次都不重试，失败立刻上抛", "-1 = never retry, raise failures immediately"),
  },
  empty: {
    title: tr("空响应重试", "Empty-response retry"),
    where: tr("SDK · 仅 openai 格式", "SDK · openai format only"),
    trigger: tr(
      "HTTP 200、finish_reason 是正常 stop，但整条响应一个内容块都没有——网关空帧、思考字段丢帧、采样打嗝都会长这样。",
      "HTTP 200 with a normal stop finish_reason, but no content blocks at all: this is what gateway empty frames, dropped thinking frames and sampling hiccups look like.",
    ),
    skips: tr(
      "因 max_tokens 截断而没有内容的不算（那要靠调高输出上限解决，重发只会再撞一次）。",
      "Responses that are empty because of max_tokens truncation do not count (raise the output limit instead; a resend would just hit it again).",
    ),
    desc: tr(
      "重发整个 prompt，所以在长上下文上比较贵，次数不宜给大。",
      "Resends the whole prompt, so it is expensive with long contexts; keep the count low.",
    ),
    attemptsLabel: tr("重试次数", "Retries"),
    defAttempts: 2,
    defInterval: tr("0.5s→1s→2s 指数（封顶 8s）", "0.5s→1s→2s exponential (max 8s)"),
    offHint: tr("-1 = 空响应直接原样交出", "-1 = pass empty responses through as-is"),
  },
  stream: {
    title: tr("同 provider 安全窗口重试", "Same-provider safe-window retry"),
    where: tr("本项目 · 未交付输出前", "ARTEX · before any output is delivered"),
    trigger: tr(
      "流已经建立（拿到 200）之后才出问题：连接中途断开、供应商 overloaded、流内的 429 / 5xx 错误事件——且一个 token 都还没交给调用方。",
      "Failures after the stream is established (200 received): mid-stream disconnect, provider overloaded, in-stream 429 / 5xx error events, while no token has been handed to the caller yet.",
    ),
    skips: tr(
      "额度耗尽（402 / insufficient_quota，交给轮询换配置）、上下文过长（413 / context length，交给压缩）、400 / 401 / 403 / 404 / 422 确定性拒绝，都不重试。",
      "Not retried: quota exhausted (402 / insufficient_quota, handled by rotating profiles), context too long (413 / context length, handled by compaction), and deterministic rejections 400 / 401 / 403 / 404 / 422.",
    ),
    desc: tr(
      "在同一个配置上重放同一个请求。因为还没交付任何输出，重放不会重复模型输出或工具执行。",
      "Replays the same request on the same profile. Since no output has been delivered, the replay cannot duplicate model output or tool execution.",
    ),
    attemptsLabel: tr("重试次数", "Retries"),
    defAttempts: 2,
    defInterval: tr("0.5s→1s 指数（封顶 4s）", "0.5s→1s exponential (max 4s)"),
    offHint: tr("-1 = 断流直接交给外层的意图重跑", "-1 = hand broken streams straight to the outer intent rerun"),
  },
  breaker: {
    title: tr("轮询熔断", "Rotation circuit breaker"),
    where: tr("本项目 · 进程级，全局一份", "ARTEX · process-wide, one global setting"),
    trigger: tr(
      "瞬时失败（429、5xx、网络错误）连续累计到阈值时熔断；余额不足（402）、密钥失效（401 / 403）、模型不存在（404）这类确定性失败不看阈值，第一次就熔断。",
      "Trips when consecutive transient failures (429, 5xx, network errors) reach the threshold; deterministic failures such as insufficient balance (402), invalid key (401 / 403) or missing model (404) trip it on the first occurrence.",
    ),
    skips: tr(
      "成功一次即清零，所以偶尔抽风的配置不会被慢慢攒到熔断。",
      "A single success resets the count, so an occasionally flaky profile will not slowly accumulate into a trip.",
    ),
    desc: tr(
      "熔断后进入冷却，冷却期内轮询直接跳过这个配置。状态落库，重启不丢。",
      "Once tripped, the profile enters a cooldown during which rotation skips it. The state is persisted and survives restarts.",
    ),
    attemptsLabel: tr("连续失败几次熔断", "Failures before tripping"),
    defAttempts: 3,
    defInterval: tr("1min→5min→30min 梯度", "1min→5min→30min steps"),
    offHint: tr(
      "-1 = 瞬时失败永不熔断（确定性失败仍然熔断）",
      "-1 = transient failures never trip it (deterministic failures still do)",
    ),
  },
  intent: {
    title: tr("意图重跑", "Intent rerun"),
    where: tr("本项目 · 进程级，全局一份", "ARTEX · process-wide, one global setting"),
    trigger: tr(
      "前面几层都没兜住：worker 以 model_error 收场——内层重试全部用尽，或者流已经开始交付输出后才断掉（那时重放不安全，只能整条重来）。",
      "None of the inner layers caught it: the worker ended with model_error, either because all inner retries were exhausted or because the stream broke after output had started (a replay is unsafe then, so the whole intent must restart).",
    ),
    skips: tr(
      "额度耗尽已经由轮询换配置处理，不在这里重跑；任务被暂停 / 终止 / 进入收尾时立即让位，不占用退避时间。",
      "Quota exhaustion is already handled by profile rotation and is not rerun here; when the task is paused / stopped / wrapping up, it yields immediately without waiting out the backoff.",
    ),
    desc: tr(
      "整条意图从头再跑一遍。它是最外层，一次重跑意味着里面几层的次数会再乘一遍。",
      "Runs the whole intent again from the start. It is the outermost layer, so each rerun multiplies the attempts of all inner layers again.",
    ),
    attemptsLabel: tr("重跑次数", "Reruns"),
    defAttempts: 2,
    defInterval: tr("固定 3s", "Fixed 3s"),
    offHint: tr("-1 = 不重跑，该意图直接判为 blocked", "-1 = no rerun, the intent is marked blocked"),
  },
} satisfies Record<string, LayerMeta>;

type LayerKey = keyof typeof RETRY_LAYERS;

/** Human-readable milliseconds, only echoed next to the input so nobody has to count zeros. */
function humanMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  return `${Number((ms / 60_000).toFixed(2))}min`;
}

/** Controlled number input: empty string ↔ 0; intermediate states ("-", "1e") stay local as typed without bothering the parent. */
function NumField({
  id,
  value,
  onChange,
  placeholder,
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  placeholder: string;
  min: number;
}) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // Follow along when the parent swaps in a whole new set of values (policy loaded, profile switched); typing doesn't land here,
  // because then value already equals the parsed result of the local text.
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((cur) => (Number(cur || 0) === value ? cur : incoming));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-28 shrink-0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? 0 : Math.trunc(n));
      }}
    />
  );
}

/** The two knobs of one retry layer. idPrefix keeps the label's htmlFor unique when it appears several times on one page. */
export function RetryRuleFields({
  layer,
  idPrefix,
  value,
  onChange,
  compact,
}: {
  layer: LayerKey;
  idPrefix: string;
  value: LLMRetryRule;
  onChange: (r: LLMRetryRule) => void;
  /** true = compact version in the profile drawer: omit the expanded explanation, keep only the "what errors reach this layer" sentence */
  compact?: boolean;
}) {
  const meta = RETRY_LAYERS[layer];
  const human = humanMs(value.interval_ms);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3 rounded-lg border p-3"}>
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-sm">{meta.title}</Label>
          <span className="text-muted-foreground text-xs">{meta.where}</span>
        </div>
        {/* Which errors reach this layer, down to the status code -- if setting the knob shows no effect, the error most likely never lands in this layer. */}
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">{tr("触发", "Triggers")}</span>
          {tr("：", ": ")}
          {meta.trigger}
        </p>
        {!compact && meta.skips && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-foreground">{tr("不走这层", "Not handled here")}</span>
            {tr("：", ": ")}
            {meta.skips}
          </p>
        )}
        {!compact && <p className="text-muted-foreground text-xs">{meta.desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-n`} className="text-muted-foreground text-xs">
            {meta.attemptsLabel}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-n`}
            min={-1}
            value={value.attempts}
            placeholder={tr(`默认 ${meta.defAttempts}`, `Default ${meta.defAttempts}`)}
            onChange={(n) => onChange({ ...value, attempts: n })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-ms`} className="text-muted-foreground text-xs">
            {tr("间隔 ms", "Interval ms")}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-ms`}
            min={0}
            value={value.interval_ms}
            placeholder={tr("默认退避", "Default backoff")}
            onChange={(n) => onChange({ ...value, interval_ms: n })}
          />
          <span className="text-muted-foreground text-xs">
            {human ? tr(`固定 ${human}`, `Fixed ${human}`) : meta.defInterval}
          </span>
        </div>
      </div>
      {!compact && (
        <p className="text-muted-foreground text-xs">
          {tr(`留空 = 用默认；${meta.offHint}。`, `Empty = default; ${meta.offHint}.`)}
        </p>
      )}
    </div>
  );
}

/** The three overridable layers in the model profile drawer (the three that follow the endpoint). */
export function ProfileRetryFields({
  value,
  onChange,
}: {
  value: LLMRetryOverride;
  onChange: (o: LLMRetryOverride) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label className="text-sm">{tr("重试覆盖", "Retry overrides")}</Label>
        <p className="text-muted-foreground text-xs">
          {tr(
            "只对这个配置生效，覆盖「重试与退避」里的全局默认。每格留空 = 跟随全局；次数填 -1 = 关掉这层重试；间隔填了就用固定间隔取代指数退避。熔断与意图重跑是进程级的，只能在全局那页调。",
            'Applies only to this profile and overrides the global defaults under "Retry & backoff". Empty = follow global; attempts -1 = disable this layer; an interval replaces exponential backoff with a fixed delay. The circuit breaker and intent rerun are process-wide and can only be set on the global tab.',
          )}
        </p>
      </div>
      {(["connect", "empty", "stream"] as const).map((k) => (
        <div key={k} className="border-t pt-3 first:border-t-0 first:pt-0">
          <RetryRuleFields
            compact
            layer={k}
            idPrefix="pf"
            value={value[k]}
            onChange={(r) => onChange({ ...value, [k]: r })}
          />
        </div>
      ))}
    </div>
  );
}

/** "Retry & backoff" tab: global defaults for all five layers. */
export function RetryPolicyPanel() {
  const [policy, setPolicy] = React.useState<LLMRetryPolicy>(ZERO_POLICY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.llmRetryPolicy();
      setPolicy({ ...ZERO_POLICY, ...p });
    } catch (e) {
      toast.error(
        tr(`读取重试策略失败：${(e as Error).message}`, `Failed to load retry policy: ${(e as Error).message}`),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // The backend clamps out-of-range values back into range and returns them; refresh with the returned values so what you see is what is stored.
      const saved = await api.saveLLMRetryPolicy(policy);
      setPolicy({ ...ZERO_POLICY, ...saved });
      toast.success(
        tr(
          "已保存，即时生效（正在跑的这一轮调用仍用旧参数）",
          "Saved and effective immediately (calls already in flight keep the old settings)",
        ),
      );
    } catch (e) {
      toast.error(tr(`保存失败：${(e as Error).message}`, `Save failed: ${(e as Error).message}`));
    } finally {
      setSaving(false);
    }
  }

  const set = (k: LayerKey) => (r: LLMRetryRule) => setPolicy((p) => ({ ...p, [k]: r }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> {tr("读取重试策略…", "Loading retry policy…")}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-relaxed">
        {tr(
          "一次模型调用的失败会依次经过五层重试，由内到外：",
          "A failed model call passes through five retry layers, from inner to outer:",
        )}
        <span className="text-foreground">
          {tr(
            " 建连 → 空响应 → 同 provider 安全窗口 → 轮询熔断 → 意图重跑",
            " connection → empty response → same-provider safe window → rotation circuit breaker → intent rerun",
          )}
        </span>
        {tr(
          "。内层用尽才轮到外层，所以次数是",
          ". An outer layer only runs once the inner one is exhausted, so attempts ",
        )}
        <span className="text-foreground">{tr("相乘", "multiply")}</span>
        {tr(
          "的——把每层都拉满，一次抖动能烧掉几十次请求。全部留空即当前默认值，与没有这页时的行为完全一致。前三层可以在每个模型配置里单独覆盖。",
          ": max out every layer and a single glitch can burn dozens of requests. Leaving everything empty keeps the current defaults, exactly the behavior without this page. The first three layers can be overridden per LLM profile.",
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(RETRY_LAYERS) as LayerKey[]).map((k) => (
          <RetryRuleFields key={k} layer={k} idPrefix="gl" value={policy[k]} onChange={set(k)} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          {tr("保存", "Save")}
        </Button>
        <Button variant="outline" onClick={() => setPolicy(ZERO_POLICY)} disabled={saving}>
          {tr("全部恢复默认", "Reset all to defaults")}
        </Button>
      </div>
    </div>
  );
}
