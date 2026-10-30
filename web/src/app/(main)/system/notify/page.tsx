"use client";

import * as React from "react";

import { BellIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { NotificationChannel, NotificationFilter, NotificationMeta } from "@/lib/types";

import {
  CHANNEL_FIELDS,
  type ChannelForm,
  emptyForm,
  KIND_LABEL,
  parseIDs,
  parseKeywords,
  parseKV,
  SEVERITY_OPTIONS,
} from "./_components/channel-fields";
import { ConfigField, FilterSummary } from "./_components/channel-form";
import { DeliveryList } from "./_components/delivery-list";
import { formatBacklog, StatTile } from "./_components/stat-tile";

// This page only orchestrates: loading data, holding form state, calling endpoints.
// Field definitions and parsing live in _components/channel-fields.ts, controls and the filter summary in
// _components/channel-form.tsx, delivery records in _components/delivery-list.tsx --
// split because each can be understood on its own, while crammed into one file this page was close to 1100 lines.
export default function NotifyPage() {
  const [meta, setMeta] = React.useState<NotificationMeta | null>(null);
  const [channels, setChannels] = React.useState<NotificationChannel[]>([]);
  const [tab, setTab] = React.useState<"channels" | "deliveries">("channels");

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<NotificationChannel | null>(null);
  const [form, setForm] = React.useState<ChannelForm>(emptyForm("dingtalk"));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const [globalSaving, setGlobalSaving] = React.useState(false);
  const [baseURL, setBaseURL] = React.useState("");
  const [digestMin, setDigestMin] = React.useState("");

  const load = React.useCallback(() => {
    api
      .notifyMeta()
      .then((m) => {
        setMeta(m);
        setBaseURL(m.public_base_url);
        setDigestMin(m.digest_interval_min);
      })
      .catch((e) =>
        toast.error(tr("读取推送配置失败：", "Failed to load notification settings: ") + (e as Error).message),
      );
    // A failure to load the channel list must be reported: failing silently would look like "there are no channels",
    // and users would think the configuration was lost, which is scarier than an outright error.
    api
      .notifyChannels()
      .then(setChannels)
      .catch((e) => toast.error(tr("读取渠道列表失败：", "Failed to load channels: ") + (e as Error).message));
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  function setF(patch: Partial<ChannelForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }
  function setCfg(key: string, value: unknown) {
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm(meta?.kinds[0]?.kind ?? "dingtalk"));
    setOpen(true);
  }

  function openEdit(ch: NotificationChannel) {
    setEditing(ch);
    // filter is a Go struct on the backend and always serializes to an object (never null), so no fallback is needed.
    const f = ch.filter;
    setForm({
      name: ch.name,
      kind: ch.kind,
      mode: ch.mode,
      enabled: ch.enabled,
      ratePerMin: String(ch.rate_per_min),
      // Credentials in the config echoed by the backend are masked values; put them into the form as is and send them back as is on submit,
      // and the backend keeps the stored original values accordingly.
      config: { ...ch.config },
      minSeverity: f.min_severity ?? "",
      includeText: (f.vulnclass_include ?? []).join("\n"),
      excludeText: (f.vulnclass_exclude ?? []).join("\n"),
      taskIDsText: (f.task_ids ?? []).join(","),
      assetIDsText: (f.asset_ids ?? []).join(","),
      onStatusChange: f.on_status_change ?? false,
    });
    setOpen(true);
  }

  // buildConfig converts form state into a channel config.
  //
  // A single rule, two kinds of values:
  //   - masked values ("__masked__...") are sent back as is → the backend reads them as "this field is unchanged, keep the stored value"
  //   - everything else is submitted exactly as the user entered it; an empty string means "clear this field"
  //
  // Credential fields get no special treatment (such as "skip blank credentials"), because that would make it **impossible** for users to clear
  // a wrongly set key -- nothing in the UI could express "I want to delete it". Under the current rule,
  // clearing the input clears the field, so the meaning is unique and under the user's control.
  // Masked values never appear in the input (see ConfigField), so "text in the box" always means
  // "typed by the user".
  function buildConfig(): Record<string, unknown> {
    const defs = CHANNEL_FIELDS[form.kind] ?? [];
    const out: Record<string, unknown> = {};
    for (const d of defs) {
      const raw = form.config[d.key];
      if (d.kind === "switch") {
        out[d.key] = raw === true;
        continue;
      }
      if (typeof raw === "string" && raw.startsWith("__masked__")) {
        out[d.key] = raw;
        continue;
      }
      if (d.kind === "number") {
        const n = Number(raw);
        out[d.key] = Number.isFinite(n) && n > 0 ? n : 0;
        continue;
      }
      if (d.kind === "kv") {
        out[d.key] = parseKV(String(raw ?? ""));
        continue;
      }
      if (d.kind === "list") {
        out[d.key] = String(raw ?? "")
          .split(/[\s,，]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        continue;
      }
      out[d.key] = String(raw ?? "").trim();
    }
    return out;
  }

  function buildFilter(): NotificationFilter {
    return {
      min_severity: form.minSeverity || undefined,
      vulnclass_include: parseKeywords(form.includeText),
      vulnclass_exclude: parseKeywords(form.excludeText),
      task_ids: parseIDs(form.taskIDsText),
      asset_ids: parseIDs(form.assetIDsText),
      on_status_change: form.onStatusChange,
    };
  }

  async function saveForm() {
    if (!form.name.trim()) {
      toast.error(tr("请填写渠道名称", "Please enter a channel name"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        mode: form.mode,
        enabled: form.enabled,
        config: buildConfig(),
        filter: buildFilter(),
        rate_per_min: form.ratePerMin.trim() === "" ? undefined : Number(form.ratePerMin),
      };
      if (editing) {
        await api.notifyUpdateChannel(editing.id, payload);
        toast.success(tr("已保存", "Saved"));
        setOpen(false);
      } else {
        await api.notifyCreateChannel(payload);
        toast.success(tr("已添加渠道", "Channel added"));
        setOpen(false);
      }
      load();
    } catch (e) {
      toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function testChannel() {
    if (!editing) return;
    setTesting(true);
    try {
      const r = await api.notifyTestChannel(editing.id);
      toast.success(
        tr(
          `已发出测试消息（${r.latency_ms} ms），请到群里确认`,
          `Test message sent (${r.latency_ms} ms). Check the channel to confirm`,
        ),
      );
    } catch (e) {
      // The backend relays the raw error returned by the channel as is; it's the only clue for debugging the configuration, so show it verbatim.
      toast.error(tr("测试失败：", "Test failed: ") + (e as Error).message, { duration: 12000 });
    } finally {
      setTesting(false);
    }
  }

  async function removeChannel(ch: NotificationChannel) {
    try {
      await api.notifyDeleteChannel(ch.id);
      toast.success(tr(`已删除：${ch.name}`, `Deleted: ${ch.name}`));
      setOpen(false);
      load();
    } catch (e) {
      toast.error(tr("删除失败：", "Delete failed: ") + (e as Error).message);
    }
  }

  async function toggleEnabled(ch: NotificationChannel) {
    try {
      await api.notifyUpdateChannel(ch.id, { enabled: !ch.enabled });
      load();
    } catch (e) {
      toast.error(tr("操作失败：", "Operation failed: ") + (e as Error).message);
    }
  }

  async function toggleGlobal(on: boolean) {
    setGlobalSaving(true);
    try {
      await api.setSettings({ notify_enabled: on });
      setMeta((m) => (m ? { ...m, enabled: on } : m));
      toast.success(on ? tr("推送已开启", "Notifications enabled") : tr("推送已暂停", "Notifications paused"));
    } catch (e) {
      toast.error(tr("操作失败：", "Operation failed: ") + (e as Error).message);
    } finally {
      setGlobalSaving(false);
    }
  }

  async function saveGlobal() {
    setGlobalSaving(true);
    try {
      const patch: Record<string, unknown> = { notify_public_base_url: baseURL.trim() };
      const n = Number(digestMin);
      if (Number.isFinite(n) && n > 0) patch.notify_digest_interval_min = n;
      await api.setSettings(patch);
      toast.success(tr("已保存", "Saved"));
      load();
    } catch (e) {
      toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message);
    } finally {
      setGlobalSaving(false);
    }
  }

  const fields = CHANNEL_FIELDS[form.kind] ?? [];
  const secretKeys = new Set(meta?.kinds.find((k) => k.kind === form.kind)?.secret_keys ?? []);
  const defaultRate = meta?.kinds.find((k) => k.kind === form.kind)?.default_rate_per_min ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tr("通知推送", "Notifications")}</h1>
          <p className="text-muted-foreground text-sm">
            {tr(
              "发现漏洞时推送到钉钉 / 飞书 / 企业微信等渠道 · 每个渠道可独立设推送时机与过滤规则",
              "Push findings to DingTalk / Feishu / WeCom and other channels · each channel has its own timing and filters",
            )}
          </p>
        </div>
        {meta && (
          // A div rather than a label: Switch has its own aria-label, and an extra wrapping label
          // neither associates with any native control nor should make clicking the text look like it toggles.
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <span className="text-muted-foreground">{tr("总开关", "Master switch")}</span>
            <Switch
              checked={meta.enabled}
              disabled={globalSaving}
              onCheckedChange={toggleGlobal}
              aria-label={tr("推送总开关", "Notifications master switch")}
            />
          </div>
        )}
      </div>

      {meta && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label={tr("渠道", "Channels")}
            value={`${meta.stats.channels_on} / ${meta.stats.channels}`}
            hint={tr("启用 / 总数", "Enabled / total")}
          />
          <StatTile label={tr("今日送达", "Delivered today")} value={String(meta.stats.sent_today)} />
          <StatTile label={tr("待发送", "Pending")} value={String(meta.stats.pending)} />
          <StatTile
            label={tr("失败", "Failed")}
            value={String(meta.stats.failed)}
            tone={meta.stats.failed > 0 ? "red" : undefined}
          />
          <StatTile
            label={tr("最久积压", "Oldest backlog")}
            value={formatBacklog(meta.stats.backlog_age_ms)}
            // Backlog age is far more useful than backlog count: a backlog of 3 can be anything from 3 seconds to 3 hours old.
            hint={meta.stats.backlog_age_ms > 5 * 60_000 ? tr("推送可能卡住了", "Delivery may be stuck") : undefined}
            tone={meta.stats.backlog_age_ms > 5 * 60_000 ? "red" : undefined}
          />
        </div>
      )}

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-base">{tr("全局设置", "Global settings")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="n-base">{tr("回链地址", "Link-back URL")}</Label>
            <Input
              id="n-base"
              placeholder="https://artex.example.com"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {tr(
                "消息里「查看详情」按钮指向的地址。留空则不带按钮。",
                'Target of the "View details" button in messages. Leave empty to omit the button.',
              )}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="n-digest">{tr("汇总周期（分钟）", "Digest interval (minutes)")}</Label>
            <Input
              id="n-digest"
              type="number"
              min={1}
              max={1440}
              placeholder="30"
              value={digestMin}
              onChange={(e) => setDigestMin(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {tr("仅对「汇总」模式的渠道生效。", 'Applies only to channels in "Digest" mode.')}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={saveGlobal} disabled={globalSaving}>
              {tr("保存全局设置", "Save global settings")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "channels" | "deliveries")} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="channels">{tr("渠道", "Channels")}</TabsTrigger>
          <TabsTrigger value="deliveries">{tr("投递记录", "Deliveries")}</TabsTrigger>
        </TabsList>

        <TabsContent value="channels">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={openAdd}
              className="text-foreground/70 border-foreground/70 hover:bg-muted/60 hover:shadow-sm flex min-h-[130px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition"
            >
              <PlusIcon className="size-6" />
              <span className="text-sm">{tr("添加渠道", "Add channel")}</span>
            </button>

            {channels.map((ch) => (
              <Card
                key={ch.id}
                onClick={() => openEdit(ch)}
                className="hover:border-primary/60 cursor-pointer gap-3 transition hover:shadow-sm"
              >
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BellIcon className="text-muted-foreground size-4 shrink-0" />
                    <CardTitle className="truncate text-base">{ch.name}</CardTitle>
                    {/* The whole card is clickable (opens edit), so these two controls must each swallow the bubbling,
                        otherwise the switch/delete would also trigger edit. stopPropagation sits on the controls
                        themselves rather than on a wrapping div: a wrapping div would create a static element that "looks interactive but has no
                        role", triggering an a11y warning and making no semantic sense. */}
                    <div className="ml-auto flex items-center gap-2">
                      <Switch
                        checked={ch.enabled}
                        onCheckedChange={() => toggleEnabled(ch)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={tr("启用", "Enabled")}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={tr("删除", "Delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          // void explicitly discards the Promise: removeChannel catches and toasts by itself,
                          // no await needed here (onClick is not async).
                          void removeChannel(ch);
                        }}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{KIND_LABEL[ch.kind] ?? ch.kind}</Badge>
                    <Badge variant="outline">
                      {ch.mode === "digest" ? tr("汇总", "Digest") : tr("实时", "Real-time")}
                    </Badge>
                    {!ch.enabled && <Badge variant="outline">{tr("已停用", "Disabled")}</Badge>}
                  </div>
                  <FilterSummary filter={ch.filter} />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="deliveries">
          <DeliveryList channels={channels} />
        </TabsContent>
      </Tabs>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? editing.name : tr("添加通知渠道", "Add notification channel")}</SheetTitle>
            <SheetDescription>
              {KIND_LABEL[form.kind] ?? form.kind}
              {defaultRate > 0
                ? tr(` · 默认限流 ${defaultRate} 条/分钟`, ` · Default rate limit ${defaultRate}/min`)
                : tr(" · 不限流", " · No rate limit")}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>{tr("渠道类型", "Channel type")}</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => {
                    // Changing the type means a different set of credential fields; the old config must not be merged in.
                    setF({ kind: v, config: {} });
                  }}
                  disabled={!!editing}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta?.kinds ?? []).map((k) => (
                      <SelectItem key={k.kind} value={k.kind}>
                        {KIND_LABEL[k.kind] ?? k.kind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editing && (
                  <p className="text-muted-foreground text-xs">
                    {tr(
                      "渠道类型不可修改——改了类型等于换一套凭据，请新建渠道。",
                      "The channel type cannot be changed (a different type means different credentials). Create a new channel instead.",
                    )}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="n-name">{tr("渠道名称", "Channel name")}</Label>
                <Input
                  id="n-name"
                  placeholder={tr("应急响应群 / 日常播报群", "Incident response / Daily digest")}
                  value={form.name}
                  onChange={(e) => setF({ name: e.target.value })}
                />
              </div>

              {fields.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {tr(
                    "该渠道的表单尚未定义（前端缺 CHANNEL_FIELDS 条目），请补全后再试。",
                    "No form is defined for this channel (the frontend is missing a CHANNEL_FIELDS entry). Add one and try again.",
                  )}
                </p>
              ) : (
                fields.map((d) => (
                  <ConfigField
                    key={d.key}
                    def={d}
                    value={form.config[d.key]}
                    isSecret={secretKeys.has(d.key)}
                    onChange={(v) => setCfg(d.key, v)}
                  />
                ))
              )}

              <div className="grid gap-2">
                <Label>{tr("推送时机", "Delivery timing")}</Label>
                <Select value={form.mode} onValueChange={(v) => setF({ mode: v as "realtime" | "digest" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realtime">
                      {tr("实时 · 每条漏洞单独发一条", "Real-time · one message per finding")}
                    </SelectItem>
                    <SelectItem value="digest">
                      {tr("汇总 · 按周期合并成一条", "Digest · combined into one message per interval")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "想做「高危实时、其余汇总」就建两个渠道：一个实时 + 门槛高危，一个汇总 + 不限级别。",
                    'For "high severity in real time, the rest as a digest", create two channels: one real-time with a High threshold, one digest with no severity limit.',
                  )}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="n-rate">{tr("限流（条/分钟）", "Rate limit (messages/min)")}</Label>
                <Input
                  id="n-rate"
                  type="number"
                  min={0}
                  placeholder={defaultRate > 0 ? String(defaultRate) : tr("0 = 不限", "0 = unlimited")}
                  value={form.ratePerMin}
                  onChange={(e) => setF({ ratePerMin: e.target.value })}
                />
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "留空用渠道默认值；0 表示不限流。超限不会丢消息，只会推迟发送。",
                    "Leave empty for the channel default; 0 means unlimited. Exceeding the limit delays messages, it never drops them.",
                  )}
                </p>
              </div>

              <div className="border-t pt-4">
                <p className="mb-3 text-sm font-medium">
                  {tr("过滤规则（留空即不过滤）", "Filters (leave empty for no filtering)")}
                </p>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>{tr("最低级别", "Minimum severity")}</Label>
                    <Select
                      value={form.minSeverity || "all"}
                      onValueChange={(v) => setF({ minSeverity: v === "all" ? "" : v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value || "all"} value={o.value || "all"}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="n-inc">{tr("只推这些漏洞类型", "Only these vulnerability types")}</Label>
                    <Textarea
                      id="n-inc"
                      placeholder={tr("SQL注入\n命令执行", "SQL injection\nCommand execution")}
                      value={form.includeText}
                      onChange={(e) => setF({ includeText: e.target.value })}
                    />
                    <p className="text-muted-foreground text-xs">
                      {tr(
                        "每行一个关键词，大小写不敏感的子串匹配。留空=全部类型。",
                        "One keyword per line, case-insensitive substring match. Empty = all types.",
                      )}
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="n-exc">{tr("排除这些漏洞类型", "Exclude these vulnerability types")}</Label>
                    <Textarea
                      id="n-exc"
                      placeholder={tr("信息泄露", "Information disclosure")}
                      value={form.excludeText}
                      onChange={(e) => setF({ excludeText: e.target.value })}
                    />
                    <p className="text-muted-foreground text-xs">
                      {tr(
                        "排除优先于包含：同时命中时会被排除。",
                        "Exclusion wins over inclusion: a finding matching both is excluded.",
                      )}
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="n-tasks">{tr("限定任务 ID", "Restrict to task IDs")}</Label>
                    <Input
                      id="n-tasks"
                      placeholder="1, 2, 3"
                      value={form.taskIDsText}
                      onChange={(e) => setF({ taskIDsText: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="n-assets">{tr("限定资产 ID", "Restrict to asset IDs")}</Label>
                    <Input
                      id="n-assets"
                      placeholder="10, 11"
                      value={form.assetIDsText}
                      onChange={(e) => setF({ assetIDsText: e.target.value })}
                    />
                    <p className="text-muted-foreground text-xs">
                      {tr(
                        "任务/资产留空=不限；填写后要求与漏洞有交集。",
                        "Empty tasks/assets = no restriction; when set, the finding must match at least one.",
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={form.onStatusChange}
                      onCheckedChange={(v) => setF({ onStatusChange: v })}
                      aria-label={tr("接收状态变更", "Receive status changes")}
                    />
                    {tr(
                      "漏洞处置状态变更时也推送（仅实时模式）",
                      "Also notify when a finding's status changes (real-time mode only)",
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setF({ enabled: v })}
                  aria-label={tr("启用", "Enabled")}
                />
                {tr("启用该渠道", "Enable this channel")}
              </div>
            </div>

            <div className="flex gap-2 pt-2 pb-6">
              <Button onClick={saveForm} disabled={saving}>
                {editing ? tr("保存", "Save") : tr("添加", "Add")}
              </Button>
              {editing && (
                <Button variant="outline" onClick={testChannel} disabled={testing}>
                  <SendIcon /> {tr("发送测试消息", "Send test message")}
                </Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
