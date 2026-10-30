import { tr } from "@/lib/i18n";

// Centralised status → color/label semantics, reused across the whole app.
// Spec §8.3: intent / coverage / task / severity each have a consistent color set.

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "rose" | "violet" | "slate";

export const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  red: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  // rose is used for "critical" — solid high emphasis, visibly stronger than the soft red outline of "high".
  rose: "bg-rose-600 text-white border-rose-600 dark:bg-rose-600 dark:text-white",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
  slate: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/20",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  rose: "bg-white",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

interface StatusMeta {
  label: string;
  tone: Tone;
}

const intent: Record<string, StatusMeta> = {
  open: { label: tr("待领", "Open"), tone: "slate" },
  running: { label: tr("执行中", "Running"), tone: "blue" },
  paused: { label: tr("已暂停", "Paused"), tone: "amber" },
  done: { label: tr("已完成", "Done"), tone: "green" },
  // blocked = model/API/network failure retries exhausted; this intent was essentially never really probed (not a target block).
  blocked: { label: tr("执行出错", "Errored"), tone: "red" },
  // exhausted = cut off midway by the step/time budget, only partial results written back (not that the direction was fully explored).
  exhausted: { label: tr("预算耗尽", "Budget exhausted"), tone: "violet" },
  // stopped = legacy soft-delete state (kept for historical data).
  stopped: { label: tr("已停止", "Stopped"), tone: "slate" },
  // deleted = the user soft-deleted this intent (node and lineage kept; see the delete_reason field for the reason).
  deleted: { label: tr("已删除", "Deleted"), tone: "slate" },
};

const task: Record<string, StatusMeta> = {
  created: { label: tr("已创建", "Created"), tone: "slate" },
  queued: { label: tr("排队中", "Queued"), tone: "amber" },
  running: { label: tr("运行中", "Running"), tone: "blue" },
  paused: { label: tr("已暂停", "Paused"), tone: "amber" },
  done: { label: tr("已完成", "Done"), tone: "green" },
  failed: { label: tr("失败", "Failed"), tone: "red" },
  timeout: { label: tr("已超时", "Timed out"), tone: "amber" },
};

const severity: Record<string, StatusMeta> = {
  critical: { label: tr("严重", "Critical"), tone: "rose" },
  high: { label: tr("高危", "High"), tone: "red" },
  medium: { label: tr("中危", "Medium"), tone: "amber" },
  low: { label: tr("低危", "Low"), tone: "slate" },
};

const finding: Record<string, StatusMeta> = {
  pending: { label: tr("待处理", "Pending"), tone: "amber" },
  in_progress: { label: tr("处理中", "In progress"), tone: "blue" },
  confirmed: { label: tr("已确认", "Confirmed"), tone: "red" },
  resolved: { label: tr("已处理", "Resolved"), tone: "green" },
  fixed: { label: tr("已修复", "Fixed"), tone: "green" },
  false_positive: { label: tr("误报", "False positive"), tone: "slate" },
  ignored: { label: tr("忽略", "Ignored"), tone: "neutral" },
  duplicate: { label: tr("重复", "Duplicate"), tone: "neutral" },
  risk_accepted: { label: tr("风险接受", "Risk accepted"), tone: "violet" },
};

const engine: Record<string, StatusMeta> = {
  exploring: { label: tr("探索中", "Exploring"), tone: "blue" },
  paused: { label: tr("已暂停", "Paused"), tone: "amber" },
  stalled: { label: tr("停滞", "Stalled"), tone: "red" },
  idle: { label: tr("空闲", "Idle"), tone: "neutral" },
};

const goal: Record<string, StatusMeta> = {
  open: { label: tr("进行中", "In progress"), tone: "blue" },
  met: { label: tr("已达成", "Met"), tone: "green" },
  abandoned: { label: tr("已放弃", "Abandoned"), tone: "slate" },
};

const audit: Record<string, StatusMeta> = {
  allow: { label: tr("放行", "Allow"), tone: "green" },
  block: { label: tr("拦截", "Block"), tone: "red" },
};

const node: Record<string, StatusMeta> = {
  observed: { label: tr("观测", "Observed"), tone: "slate" },
  confirmed: { label: tr("确认", "Confirmed"), tone: "green" },
  tombstoned: { label: tr("废弃", "Tombstoned"), tone: "neutral" },
};

// Notification delivery status. sending uses blue rather than amber: it is not "a problem"
// but "claimed and being sent", and must be distinguishable from pending's waiting semantics.
const delivery: Record<string, StatusMeta> = {
  pending: { label: tr("待发送", "Pending"), tone: "amber" },
  sending: { label: tr("发送中", "Sending"), tone: "blue" },
  sent: { label: tr("已送达", "Delivered"), tone: "green" },
  failed: { label: tr("失败", "Failed"), tone: "red" },
  skipped: { label: tr("已跳过", "Skipped"), tone: "neutral" },
};

const maps = {
  intent,
  task,
  severity,
  finding,
  engine,
  goal,
  audit,
  node,
  delivery,
} as const;

export type StatusDomain = keyof typeof maps;

export function statusMeta(domain: StatusDomain, key: string): StatusMeta {
  return maps[domain][key] ?? { label: key, tone: "neutral" };
}
