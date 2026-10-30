"use client";

import * as React from "react";

import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  CopyIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { TablePagination } from "@/components/table-pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { intlLocale, tr } from "@/lib/i18n";
import type {
  InterceptApprovalFilter,
  InterceptApprovalRow,
  InterceptAudit,
  InterceptDetail,
  InterceptPending,
  InterceptReviewInput,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function fmtTime(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(intlLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Model verdict reasons are prefixed "[model] "; rows written before the English fork use "[模型] ".
const MODEL_REASON_PREFIX = /^\[(?:model|模型)\]\s*/;

function source(row: InterceptApprovalRow) {
  if (row.decision_source) return row.decision_source;
  if (row.rule_id) return "rule";
  return MODEL_REASON_PREFIX.test(row.reason ?? "") ? "model" : "unknown";
}

function originLabel(row: InterceptApprovalRow) {
  if (row.task_id) return row.task_id;
  if (row.conversation_id) return tr(`对话 #${row.conversation_id}`, `Conversation #${row.conversation_id}`);
  return "—";
}

function ApprovalOrigin({ row, detail = false }: { row: InterceptApprovalRow; detail?: boolean }) {
  const [locating, setLocating] = React.useState(false);
  const label = detail && row.task_id ? tr(`任务 ${row.task_id}`, `Task ${row.task_id}`) : originLabel(row);
  const query = new URLSearchParams({ approval: String(row.id) });
  let href: string | undefined;
  if (row.conversation_id) {
    query.set("c", String(row.conversation_id));
    href = `/chat?${query}`;
  } else if (row.task_id) {
    query.set("id", row.task_id);
    href = `/function/tasks/detail?${query}`;
  }
  return href ? (
    <a
      href={href}
      className="text-primary underline-offset-4 hover:underline"
      aria-label={tr(`定位审批 #${row.id} 的来源：${label}`, `Go to the source of approval #${row.id}: ${label}`)}
      aria-busy={locating}
      onClick={async (e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (locating) return;
        setLocating(true);
        try {
          await api.interceptExecution(row.id, row.conversation_id ?? undefined);
          window.location.assign(href);
        } catch (error) {
          toast.error((error as Error).message || tr("无法定位对应执行", "Unable to locate the matching execution"));
          setLocating(false);
        }
      }}
    >
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: tr("待审批", "Pending"),
    allowed: tr("已允许", "Allowed"),
    denied: tr("已拒绝", "Denied"),
    timeout: tr("已超时", "Timed out"),
  };
  let variant: "default" | "destructive" | "secondary" | "outline" = "outline";
  if (status === "allowed") variant = "default";
  if (status === "denied") variant = "destructive";
  if (status === "pending") variant = "secondary";
  return <Badge variant={variant}>{labels[status] ?? status}</Badge>;
}

function MatchCell({ row, showReason = true }: { row: InterceptApprovalRow; showReason?: boolean }) {
  const reason = row.reason?.replace(MODEL_REASON_PREFIX, "");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {source(row) === "model" ? (
        <Badge variant="outline">
          <BotIcon />
          {tr("模型判定", "Model decision")}
        </Badge>
      ) : (
        <span className="truncate">{row.rule_name || tr("规则未记录或已删除", "Rule not recorded or deleted")}</span>
      )}
      {showReason ? (
        <p className="truncate text-muted-foreground text-xs" title={reason}>
          {reason || tr("未记录理由", "No reason recorded")}
        </p>
      ) : null}
    </div>
  );
}

function CodeBlock({ label, text, truncated = false }: { label: string; text: string; truncated?: boolean }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tr("已复制", "Copied"));
    } catch {
      toast.error(tr("复制失败，请手动选择内容复制", "Copy failed; select the text and copy it manually"));
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">{label}</h3>
        {text ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={tr(`复制${label}`, `Copy ${label}`)}
            onClick={() => void copy()}
          >
            <CopyIcon />
          </Button>
        ) : null}
      </div>
      <pre className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 font-mono text-xs leading-6 [overflow-wrap:anywhere]">
        {text || tr("未记录", "Not recorded")}
      </pre>
      {truncated ? (
        <p className="text-muted-foreground text-xs">
          {tr("内容已截断，以上为保存的片段。", "Content truncated; the above is the saved excerpt.")}
        </p>
      ) : null}
    </section>
  );
}

const contextLabels: Record<string, string> = {
  user: tr("用户消息", "User message"),
  assistant: tr("Agent 消息", "Agent message"),
  text: tr("Agent 消息", "Agent message"),
  tool_use: tr("工具请求", "Tool request"),
  tool_result: tr("工具输出", "Tool output"),
};

const actionLabels: Record<string, string> = {
  allow: tr("允许", "Allow"),
  ask: tr("转人工审批", "Hand to human approval"),
  deny: tr("拒绝", "Deny"),
};
const executionLabels: Record<InterceptAudit["execution_status"], string> = {
  not_started: tr("尚未执行", "Not started"),
  not_executed: tr("未执行", "Not executed"),
  awaiting_result: tr("已允许，等待执行结果", "Allowed, awaiting result"),
  succeeded: tr("执行成功", "Succeeded"),
  failed: tr("执行失败", "Failed"),
  unknown: tr("执行结果未知", "Result unknown"),
};

function ModelReviewContext({ input }: { input: InterceptReviewInput }) {
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={tr("模型审查上下文", "Model review context")}>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-sm">{tr("模型审查上下文", "Model review context")}</h3>
        <p className="text-muted-foreground text-xs">
          {tr(
            "以下为本次实际发送给审查模型的输入快照。背景仅用于理解当前动作，裁决依据为审查策略。",
            "Below is a snapshot of the input actually sent to the review model. Background only helps interpret the current action; the verdict follows the review policy. ",
          )}
          {input.version < 4
            ? tr(
                "此记录使用旧版输入，保留当时实际发送的内容。",
                "This record uses the legacy input format and keeps exactly what was sent at the time.",
              )
            : null}
        </p>
      </div>
      <CodeBlock
        label={tr("当前待审查调用", "Call under review")}
        text={JSON.stringify({ tool_name: input.tool_name, arguments: input.arguments }, null, 2)}
      />
      {input.version >= 2 ? (
        input.background ? (
          <div className="flex min-w-0 flex-col gap-2">
            <CodeBlock
              label={
                input.background.source === "user_message"
                  ? tr("背景 · 用户消息", "Background · User message")
                  : tr("背景 · Worker 意图摘要（旧版）", "Background · Worker intent summary (legacy)")
              }
              text={input.background.text}
              truncated={input.background.truncated}
            />
            <p className="text-muted-foreground text-xs">
              {input.background.source === "user_message"
                ? tr("取自当前用户消息。", "Taken from the current user message.")
                : tr(
                    "这是旧版发送的 Worker 意图摘要；新版 Worker 审查不再发送此内容。",
                    "This is the worker intent summary sent by the legacy version; newer worker reviews no longer send it.",
                  )}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {tr("本次审查未附带背景消息。", "No background message was attached to this review.")}
          </p>
        )
      ) : (
        <>
          {input.turn_input ? (
            <CodeBlock
              label={tr("当前轮输入（旧版）", "Current turn input (legacy)")}
              text={input.turn_input}
              truncated={input.background_truncated}
            />
          ) : null}
          {input.task ? (
            <>
              <CodeBlock
                label={tr("任务描述（旧版）", "Task description (legacy)")}
                text={input.task.description}
                truncated={input.task.truncated}
              />
              <CodeBlock
                label={tr("任务目标（旧版）", "Task goal (legacy)")}
                text={input.task.goal}
                truncated={input.task.truncated}
              />
              <CodeBlock
                label={tr("任务操作约束（旧版）", "Task operation constraints (legacy)")}
                text={JSON.stringify(input.task.constraints, null, 2)}
              />
            </>
          ) : null}
          {input.worker_intent ? (
            <CodeBlock
              label={tr("Worker 意图（旧版）", "Worker intent (legacy)")}
              text={input.worker_intent}
              truncated={input.background_truncated}
            />
          ) : null}
        </>
      )}
      {input.working_directory ? (
        <CodeBlock label={tr("工作目录", "Working directory")} text={input.working_directory} />
      ) : null}
      {input.version >= 3 ? (
        <p className="text-muted-foreground text-xs">
          {tr(
            "本次审查未发送历史调用或执行结果。",
            "No previous calls or execution results were sent for this review.",
          )}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <h4 className="font-medium text-muted-foreground text-xs">
            {tr("当时提供给模型的历史调用（旧版）", "Previous calls given to the model at the time (legacy)")}
          </h4>
          {input.history?.length ? (
            input.history.map((entry) => (
              <div key={entry.tool_use_id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
                <p className="break-words font-medium text-xs">
                  {entry.tool} ·{" "}
                  {entry.status === "succeeded"
                    ? tr("成功", "Succeeded")
                    : tr("失败（可能有部分副作用）", "Failed (may have partial side effects)")}
                </p>
                <CodeBlock
                  label={tr("历史调用参数", "Previous call arguments")}
                  text={entry.arguments_preview}
                  truncated={entry.truncated}
                />
                <CodeBlock
                  label={tr("历史执行结果", "Previous execution result")}
                  text={entry.result}
                  truncated={entry.truncated}
                />
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-xs">
              {tr(
                "本次未提供可配对的历史工具执行记录。",
                "No matched previous tool executions were provided this time.",
              )}
            </p>
          )}
          {input.history_truncated ? (
            <p className="text-muted-foreground text-xs">
              {tr("历史为有限窗口，部分内容已截断。", "History is a limited window; some content was truncated.")}
            </p>
          ) : null}
        </div>
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="self-start">
            <ChevronDownIcon data-icon="inline-start" />
            {tr("查看完整模型审查输入 JSON", "View full model review input JSON")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <CodeBlock label={tr("模型审查输入", "Model review input")} text={JSON.stringify(input, null, 2)} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

type Decide = (id: number, decision: "allowed" | "denied") => Promise<void>;

function DecisionActions({ row, busy, decide }: { row: InterceptApprovalRow; busy: boolean; decide: Decide }) {
  if (row.status !== "pending") return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy} onClick={() => void decide(row.id, "allowed")}>
        <CheckIcon data-icon="inline-start" />
        {tr("允许", "Allow")}
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => void decide(row.id, "denied")}>
        <XIcon data-icon="inline-start" />
        {tr("拒绝", "Deny")}
      </Button>
    </div>
  );
}

export function ApprovalDetail({
  row,
  busy,
  decide,
  revision,
  readOnly = false,
  defaultExpanded = false,
  onResolved,
}: {
  row: InterceptApprovalRow;
  busy: boolean;
  decide: Decide;
  revision: number;
  readOnly?: boolean;
  defaultExpanded?: boolean;
  onResolved?: (status: "allowed" | "denied" | "timeout") => void;
}) {
  const [detail, setDetail] = React.useState<InterceptDetail | null>(null);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [more, setMore] = React.useState(defaultExpanded);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Status, refresh and retry invalidate details without closing the panel.
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await api.interceptDetail(row.id);
        if (cancelled) return;
        setDetail(next);
        setError("");
        if (next.status !== "pending") onResolved?.(next.status);
        if (next.status === "pending" || next.audit?.execution_status === "awaiting_result")
          timer = setTimeout(() => void load(), 5000);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || tr("详情加载失败", "Failed to load details"));
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [row.id, row.status, revision, retry, onResolved]);

  // Row updates are authoritative until the lazy detail has caught up.
  const current = detail?.status === row.status ? detail : row;
  const audit = detail?.audit;
  let execution = audit ? executionLabels[audit.execution_status] : tr("未记录", "Not recorded");
  if (row.status === "pending") execution = tr("尚未执行", "Not started");
  if (audit && audit.correlation !== "exact" && audit.effective_action === "allow")
    execution = tr("未关联执行结果", "No linked execution result");
  const command = typeof row.tool_input?.command === "string" ? row.tool_input.command : undefined;
  let initialLabel =
    source(row) === "model" ? tr("模型初判", "Initial model verdict") : tr("规则初判", "Initial rule verdict");
  if (audit?.model_fallback) initialLabel = tr("模型异常回退", "Model failure fallback");

  return (
    <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-5">
      <div className="grid min-w-0 gap-5 rounded-xl border bg-muted/20 p-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <CodeBlock
            label={`${current.agent_name || current.conv_agent_key || "Agent"} · ${tr("工具请求", "Tool request")}`}
            text={JSON.stringify(row.tool_input ?? {}, null, 2)}
          />
          {command ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  <ChevronDownIcon data-icon="inline-start" />
                  {tr("查看命令内容", "View command")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <CodeBlock label={tr("命令内容", "Command")} text={command} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {tr("执行结果：", "Execution result: ")}
            <span className="text-foreground">{detail ? execution : tr("加载中…", "Loading…")}</span>
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:pl-5">
          <h3 className="font-medium text-muted-foreground text-xs">
            {current.status === "pending" ? tr("审查状态", "Review status") : tr("审批裁决", "Approval verdict")}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={current.status} />
            <MatchCell row={current} showReason={false} />
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
            {current.reason?.replace(MODEL_REASON_PREFIX, "") || tr("未记录审批理由", "No approval reason recorded")}
          </p>
          {audit?.decision_reason ? <p className="text-sm">{audit.decision_reason}</p> : null}
          {audit?.effective_action ? (
            <p className="text-sm">
              {tr("最终动作：", "Final action: ")}
              {actionLabels[audit.effective_action]}
            </p>
          ) : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
            <dt className="text-muted-foreground">{tr("来源", "Source")}</dt>
            <dd className="break-words">
              <ApprovalOrigin row={current} detail />
            </dd>
            <dt className="text-muted-foreground">{tr("申请时间", "Requested at")}</dt>
            <dd>{fmtTime(row.created_at)}</dd>
            <dt className="text-muted-foreground">{tr("决定时间", "Decided at")}</dt>
            <dd>{fmtTime(current.decided_at)}</dd>
            {audit?.rule_name ? (
              <>
                <dt className="text-muted-foreground">{tr("规则快照", "Rule snapshot")}</dt>
                <dd>{audit.rule_name}</dd>
              </>
            ) : null}
            {audit?.profile_id ? (
              <>
                <dt className="text-muted-foreground">{tr("审批模型配置", "Approval LLM profile")}</dt>
                <dd>#{audit.profile_id}</dd>
              </>
            ) : null}
          </dl>
          {!readOnly ? <DecisionActions row={current} busy={busy} decide={decide} /> : null}
        </div>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            <div className="flex flex-wrap items-center gap-2">
              <span>{tr(`详情加载失败：${error}`, `Failed to load details: ${error}`)}</span>
              <Button variant="outline" size="sm" onClick={() => setRetry((v) => v + 1)}>
                {tr("重试详情", "Retry")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {!detail && !error ? <Skeleton className="h-8 w-60" /> : null}
      {detail && !audit ? (
        <Alert>
          <AlertDescription>
            {tr(
              "此记录未保存审批详情快照，无法还原当时的上下文、模型初判和执行输出。",
              "No approval detail snapshot was saved for this record, so the context, initial model verdict and execution output at the time cannot be restored.",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {audit ? (
        <Collapsible open={more} onOpenChange={setMore}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              <ChevronDownIcon data-icon="inline-start" className={cn(more && "rotate-180")} />
              {more
                ? tr("收起上下文", "Hide context")
                : tr("查看上下文与执行结果", "View context and execution result")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="flex min-w-0 flex-col gap-5">
              {audit.model_input ? (
                <ModelReviewContext input={audit.model_input} />
              ) : (
                <Alert>
                  <AlertDescription>
                    {audit.model_input_digest
                      ? tr(
                          "此历史记录仅保存审查输入指纹，未保存输入原文，无法还原当时发给模型的上下文。这不代表审查时没有上下文；新产生的模型裁决会保留输入快照。",
                          "This record only stores a fingerprint of the review input, not the input itself, so the context sent to the model cannot be restored. That does not mean there was no context; new model verdicts keep an input snapshot.",
                        )
                      : tr(
                          "此记录没有保存模型审查输入，可能由规则直接裁决、模型调用前发生异常或产生于旧版本。",
                          "No model review input was saved for this record. It may have been decided by a rule, failed before the model call, or come from an older version.",
                        )}
                  </AlertDescription>
                </Alert>
              )}
              {audit.user_message || audit.context?.length ? (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <ChevronDownIcon data-icon="inline-start" />
                      {audit.model_input && audit.model_input.version >= 3
                        ? tr("查看会话审计片段（未发送模型）", "View session audit excerpt (not sent to the model)")
                        : tr("查看会话审计片段", "View session audit excerpt")}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <div className="flex min-w-0 flex-col gap-3">
                      {audit.user_message ? (
                        <CodeBlock
                          label={tr("会话当前轮输入（审计片段）", "Current turn input (audit excerpt)")}
                          text={audit.user_message}
                          truncated={audit.user_truncated}
                        />
                      ) : null}
                      <section className="flex min-w-0 flex-col gap-3">
                        <h3 className="font-medium text-muted-foreground text-xs">
                          {tr("可见会话上下文", "Visible session context")}
                        </h3>
                        <p className="text-muted-foreground text-xs">
                          {tr(
                            `保存于 ${fmtTime(audit.captured_at)} 的会话记录片段。模型实际使用的内容以“模型审查输入”为准。`,
                            `Session excerpt saved at ${fmtTime(audit.captured_at)}. What the model actually used is shown under "Model review input".`,
                          )}
                        </p>
                        {audit.context_truncated ? (
                          <p className="text-muted-foreground text-xs">
                            {tr(
                              "仅保存最近的上下文，部分内容已截断。",
                              "Only recent context is kept; some content was truncated.",
                            )}
                          </p>
                        ) : null}
                        {audit.context?.length ? (
                          audit.context.map((entry, index) => (
                            <CodeBlock
                              key={`${entry.kind}-${entry.tool_use_id || index}`}
                              label={`${contextLabels[entry.kind] ?? entry.kind}${entry.tool ? ` · ${entry.tool}` : ""}${entry.is_error ? tr(" · 异常", " · Error") : ""}`}
                              text={entry.text}
                              truncated={entry.truncated}
                            />
                          ))
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            {tr("未记录可关联的上下文", "No linked context recorded")}
                          </p>
                        )}
                      </section>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              <CodeBlock
                label={`${initialLabel}${tr("：", ": ")}${actionLabels[audit.initial_action] ?? audit.initial_action}`}
                text={audit.initial_reason.replace(MODEL_REASON_PREFIX, "")}
              />
              <CodeBlock
                label={tr("执行输出", "Execution output")}
                text={
                  audit.output ??
                  (audit.execution_status === "not_executed"
                    ? tr("工具未执行。", "The tool was not executed.")
                    : tr("尚无执行输出", "No execution output yet"))
                }
                truncated={audit.output_truncated}
              />
              {audit.correlation !== "exact" ? (
                <Alert>
                  <AlertDescription>
                    {audit.correlation === "ambiguous"
                      ? tr(
                          "存在相同参数的并发调用，无法唯一关联工具调用；本记录不展示推测的执行结果。",
                          "Concurrent calls with identical arguments exist, so the tool call cannot be linked uniquely; no guessed execution result is shown.",
                        )
                      : tr("未记录可唯一关联的工具调用 ID。", "No uniquely linkable tool call ID was recorded.")}
                  </AlertDescription>
                </Alert>
              ) : null}
              <dl className="grid gap-2 text-muted-foreground text-xs [overflow-wrap:anywhere]">
                <div>
                  {tr("工具调用 ID：", "Tool call ID: ")}
                  {audit.tool_use_id || tr("未记录", "Not recorded")}
                </div>
                <div>
                  {tr("参数摘要 SHA-256：", "Arguments digest SHA-256: ")}
                  {audit.input_digest}
                </div>
                <div>
                  {tr("审查配置指纹 SHA-256：", "Review config fingerprint SHA-256: ")}
                  {audit.config_digest || tr("未记录", "Not recorded")}
                </div>
                {audit.model_input_digest ? (
                  <div>
                    {tr("模型审查输入 SHA-256：", "Model review input SHA-256: ")}
                    {audit.model_input_digest}
                  </div>
                ) : null}
                {audit.execution_ended_at ? (
                  <div>
                    {tr("结果记录时间：", "Result recorded at: ")}
                    {fmtTime(audit.execution_ended_at)}
                  </div>
                ) : null}
              </dl>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

// Hidden cells do not occupy table columns. Keep the detail span in sync so
// expansion cannot create empty columns and leave a gap in the selected row.
const approvalBreakpoints = ["(min-width: 40rem)", "(min-width: 48rem)", "(min-width: 64rem)", "(min-width: 80rem)"];
function subscribeColumns(onChange: () => void) {
  const queries = approvalBreakpoints.map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}
function visibleColumnCount() {
  const matches = approvalBreakpoints.map((query) => window.matchMedia(query).matches);
  return 3 + Number(matches[0]) + Number(matches[1]) + 2 * Number(matches[2]) + 2 * Number(matches[3]);
}
function serverColumnCount() {
  return 9;
}

function ApprovalTable({
  rows,
  busy,
  decide,
  revision,
  label,
}: {
  rows: InterceptApprovalRow[];
  busy: boolean;
  decide: Decide;
  revision: number;
  label: string;
}) {
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());
  const columns = React.useSyncExternalStore(subscribeColumns, visibleColumnCount, serverColumnCount);
  const prefix = React.useId();
  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Table className="table-fixed" aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <span className="sr-only">{tr("展开详情", "Expand details")}</span>
          </TableHead>
          <TableHead className="hidden w-14 sm:table-cell">#</TableHead>
          <TableHead className="w-28">{tr("工具", "Tool")}</TableHead>
          <TableHead className="hidden md:table-cell">{tr("来源", "Source")}</TableHead>
          <TableHead className="hidden lg:table-cell">{tr("匹配规则", "Matched rule")}</TableHead>
          <TableHead className="hidden xl:table-cell">{tr("参数", "Arguments")}</TableHead>
          <TableHead className="w-24">{tr("状态", "Status")}</TableHead>
          <TableHead className="hidden w-36 lg:table-cell">{tr("申请时间", "Requested at")}</TableHead>
          <TableHead className="hidden w-36 xl:table-cell">{tr("决定时间", "Decided at")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const open = expanded.has(row.id);
          const panelID = `${prefix}-${row.id}`;
          return (
            <React.Fragment key={row.id}>
              <TableRow
                data-state={open ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => toggle(row.id)}
              >
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      open
                        ? tr(`收起审批 #${row.id}`, `Collapse approval #${row.id}`)
                        : tr(`展开审批 #${row.id}`, `Expand approval #${row.id}`)
                    }
                    aria-expanded={open}
                    aria-controls={open ? panelID : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(row.id);
                    }}
                  >
                    {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </Button>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{row.id}</TableCell>
                <TableCell>
                  <code className="block truncate text-xs">{row.tool_name}</code>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-col gap-1">
                    <span className="truncate" title={originLabel(row)}>
                      <ApprovalOrigin row={row} />
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {row.agent_name || row.conv_agent_key}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <MatchCell row={row} />
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <code className="block truncate text-muted-foreground text-xs">{JSON.stringify(row.tool_input)}</code>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground text-xs lg:table-cell">
                  {fmtTime(row.created_at)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground text-xs xl:table-cell">
                  {fmtTime(row.decided_at)}
                </TableCell>
              </TableRow>
              {open ? (
                <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
                  <TableCell colSpan={columns} className="whitespace-normal p-0">
                    <section id={panelID} aria-label={tr(`审批详情 #${row.id}`, `Approval details #${row.id}`)}>
                      <ApprovalDetail row={row} busy={busy} decide={decide} revision={revision} />
                    </section>
                  </TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function ApprovalRecords({ taskId }: { taskId?: string }) {
  const [rows, setRows] = React.useState<InterceptApprovalRow[]>([]);
  const [pendingRows, setPendingRows] = React.useState<InterceptPending[]>([]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [total, setTotal] = React.useState(0);
  const [filter, setFilter] = React.useState<InterceptApprovalFilter>({});
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [pendingError, setPendingError] = React.useState("");
  const [deciding, setDeciding] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const request = React.useRef(0);
  const decisionLock = React.useRef(false);
  const filterID = React.useId();
  const filtered = Boolean(filter.status || filter.decision_source);

  // A task can stay mounted while the user switches between task details.
  // Reset the cursor so the new scope always starts at its newest records.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId intentionally resets pagination when scope changes.
  React.useEffect(() => {
    setPage(1);
  }, [taskId]);

  const load = React.useCallback(
    async (manual = false) => {
      const id = ++request.current;
      if (manual) setRefreshing(true);
      try {
        // The approval queue is independent of the current history page and its
        // filter. Older requests must remain actionable even when newer decisions
        // fill the page or a filter would hide them.
        const [history, pending] = await Promise.allSettled([
          taskId
            ? api.interceptTaskPage(taskId, page, pageSize, filter)
            : api.interceptHistoryPage(page, pageSize, filter),
          api.interceptPending(),
        ]);
        if (id !== request.current) return;
        if (history.status === "fulfilled") {
          setRows(history.value.items);
          setTotal(history.value.total);
          setError("");
        } else {
          setError((history.reason as Error).message || tr("加载失败", "Load failed"));
        }
        if (pending.status === "fulfilled") {
          setPendingRows(pending.value);
          setPendingError("");
        } else {
          setPendingError((pending.reason as Error).message || tr("加载失败", "Load failed"));
        }
        if (manual) setRevision((v) => v + 1);
      } catch (e) {
        if (id === request.current) setError((e as Error).message || tr("加载失败", "Load failed"));
      } finally {
        if (id === request.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [taskId, page, pageSize, filter],
  );
  const latestLoad = React.useRef(load);
  latestLoad.current = load;

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      request.current++;
      clearInterval(timer);
    };
  }, [load]);

  const changePageSize = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const changeFilter = (next: InterceptApprovalFilter) => {
    // An in-flight response for the old filter must not repopulate the table.
    request.current++;
    setFilter(next);
    setPage(1);
    setRows([]);
    setTotal(0);
    setError("");
    setLoading(true);
  };

  const decide: Decide = async (id, decision) => {
    if (decisionLock.current) return;
    decisionLock.current = true;
    setDeciding(true);
    try {
      await api.interceptDecide(id, decision);
      // Invalidate a list request started before this decision.
      request.current++;
      // Optimistically drop the decided item from the independent pending queue
      // for instant feedback; the re-fetch below reconciles with server truth.
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, status: decision, decided_at: new Date().toISOString() } : row)),
      );
      setPendingRows((prev) => prev.filter((row) => row.id !== id));
      setRevision((v) => v + 1);
      toast.success(
        decision === "allowed" ? tr("已允许执行", "Execution allowed") : tr("已拒绝执行", "Execution denied"),
      );
      // Re-fetch counts and rows: a decided item may no longer match the filter.
      await latestLoad.current(true);
    } catch (e) {
      toast.error((e as Error).message);
      await latestLoad.current(true);
    } finally {
      decisionLock.current = false;
      setDeciding(false);
    }
  };

  const historyById = new Map(rows.map((row) => [row.id, row]));
  const pending: InterceptApprovalRow[] = pendingRows
    .filter((row) => !taskId || row.task_id === taskId)
    .map((row) => ({
      conv_title: "",
      conv_agent_key: "",
      rule_name: row.rule_id ? tr(`规则 #${row.rule_id}`, `Rule #${row.rule_id}`) : "",
      ...historyById.get(row.id),
      ...row,
    }));
  const title = taskId ? tr("拦截审批", "Intercept approvals") : tr("审批记录", "Approval records");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardListIcon className="size-5 text-muted-foreground" />
          <h1 className="font-semibold text-xl">{title}</h1>
          {pending.length ? (
            <Badge variant="secondary">{tr(`${pending.length} 待审批`, `${pending.length} pending`)}</Badge>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading || refreshing}>
          <RefreshCwIcon data-icon="inline-start" className={cn(refreshing && "animate-spin")} />
          {tr("刷新", "Refresh")}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        {tr(
          "展开记录查看工具请求和审批裁决，以及当时的上下文与执行结果。",
          "Expand a record to see the tool request and approval verdict, along with the context and execution result at the time.",
        )}
      </p>
      <FieldGroup
        className="flex-row flex-wrap items-end gap-3"
        aria-label={tr("审批记录筛选", "Approval record filters")}
      >
        <Field className="w-full sm:w-40">
          <FieldLabel htmlFor={`${filterID}-status`}>{tr("审批状态", "Approval status")}</FieldLabel>
          <Select
            value={filter.status ?? "all"}
            onValueChange={(value) =>
              changeFilter({
                ...filter,
                status: value === "all" ? undefined : (value as InterceptApprovalFilter["status"]),
              })
            }
          >
            <SelectTrigger id={`${filterID}-status`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{tr("全部状态", "All statuses")}</SelectItem>
                <SelectItem value="denied">{tr("已拒绝", "Denied")}</SelectItem>
                <SelectItem value="pending">{tr("待审批", "Pending")}</SelectItem>
                <SelectItem value="allowed">{tr("已允许", "Allowed")}</SelectItem>
                <SelectItem value="timeout">{tr("已超时", "Timed out")}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field className="w-full sm:w-40">
          <FieldLabel htmlFor={`${filterID}-source`}>{tr("判定来源", "Decision source")}</FieldLabel>
          <Select
            value={filter.decision_source ?? "all"}
            onValueChange={(value) =>
              changeFilter({
                ...filter,
                decision_source: value === "all" ? undefined : (value as InterceptApprovalFilter["decision_source"]),
              })
            }
          >
            <SelectTrigger id={`${filterID}-source`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{tr("全部来源", "All sources")}</SelectItem>
                <SelectItem value="model">{tr("模型判定", "Model decision")}</SelectItem>
                <SelectItem value="rule">{tr("规则判定", "Rule decision")}</SelectItem>
                <SelectItem value="unknown">{tr("来源未知", "Unknown source")}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => changeFilter({})}>
            {tr("清除筛选", "Clear filters")}
          </Button>
        ) : null}
      </FieldGroup>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {tr(
              `记录加载失败：${error}。请点击刷新重试。`,
              `Failed to load records: ${error}. Click Refresh to retry.`,
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {pendingError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {tr(
              `待审批加载失败：${pendingError}。请点击刷新重试。`,
              `Failed to load pending approvals: ${pendingError}. Click Refresh to retry.`,
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {pending.length ? (
        <section className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3 font-medium text-sm">
            <ShieldAlertIcon className="size-4" />
            {tr(`待处理（${pending.length}）`, `Pending (${pending.length})`)}
            <span className="text-muted-foreground text-xs">{tr("展开后允许或拒绝", "Expand to allow or deny")}</span>
          </div>
          <ApprovalTable
            rows={pending}
            busy={deciding}
            decide={decide}
            revision={revision}
            label={tr("待处理审批", "Pending approvals")}
          />
        </section>
      ) : null}
      <section className="overflow-hidden rounded-xl border">
        <div className="border-b px-4 py-3 font-medium text-sm">
          {filtered
            ? tr(`筛选结果（${total}）`, `Filtered results (${total})`)
            : tr(`全部记录（${total}）`, `All records (${total})`)}
        </div>
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : null}
        {!loading && !rows.length && !error ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardListIcon />
              </EmptyMedia>
              <EmptyTitle>
                {filtered
                  ? tr("没有符合筛选条件的审批记录", "No approval records match the filters")
                  : tr("暂无审批记录", "No approval records yet")}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? tr(
                      "请调整审批状态或判定来源，或清除筛选查看全部记录。",
                      "Adjust the approval status or decision source, or clear the filters to see all records.",
                    )
                  : tr(
                      "规则或模型作出审批决定后，记录将显示在这里。",
                      "Records appear here once a rule or the model makes an approval decision.",
                    )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {rows.length ? (
          <ApprovalTable
            rows={rows}
            busy={deciding}
            decide={decide}
            revision={revision}
            label={tr("审批记录列表", "Approval record list")}
          />
        ) : null}
        {!loading && !error ? (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        ) : null}
      </section>
    </div>
  );
}
