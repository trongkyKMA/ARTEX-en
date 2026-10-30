"use client";

import * as React from "react";

import { BanIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { AssetInterceptKind, AssetInterceptRule } from "@/lib/types";

// ---- kind metadata ----

const GROUP_EXACT = tr("全等匹配", "Exact match");
const GROUP_FUZZY = tr("模糊匹配", "Fuzzy match");
const GROUP_CIDR = tr("网段", "Network range");

const KIND_OPTIONS: { value: AssetInterceptKind; label: string; group: string; placeholder: string }[] = [
  {
    value: "exact_domain",
    label: tr("域名（全等）", "Domain (exact)"),
    group: GROUP_EXACT,
    placeholder: "example.gov.cn",
  },
  { value: "exact_ip", label: tr("IP（全等）", "IP (exact)"), group: GROUP_EXACT, placeholder: "203.0.113.10" },
  {
    value: "exact_url",
    label: tr("URL（全等）", "URL (exact)"),
    group: GROUP_EXACT,
    placeholder: "https://example.gov.cn/login",
  },
  { value: "fuzzy_domain", label: tr("域名（模糊）", "Domain (fuzzy)"), group: GROUP_FUZZY, placeholder: ".gov.cn" },
  { value: "fuzzy_ip", label: tr("IP（模糊）", "IP (fuzzy)"), group: GROUP_FUZZY, placeholder: "203.0.113." },
  { value: "fuzzy_url", label: tr("URL（模糊）", "URL (fuzzy)"), group: GROUP_FUZZY, placeholder: "/admin" },
  { value: "cidr", label: tr("CIDR 网段", "CIDR range"), group: GROUP_CIDR, placeholder: "192.168.0.0/16" },
];

const KIND_LABEL: Record<AssetInterceptKind, string> = Object.fromEntries(
  KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<AssetInterceptKind, string>;

const KIND_GROUPS = [GROUP_EXACT, GROUP_FUZZY, GROUP_CIDR];

function KindBadge({ kind }: { kind: AssetInterceptKind }) {
  const fuzzy = kind.startsWith("fuzzy_");
  const cidr = kind === "cidr";
  return (
    <Badge
      variant="outline"
      className={
        cidr
          ? "border-sky-400 text-sky-600"
          : fuzzy
            ? "border-amber-400 text-amber-600"
            : "border-emerald-400 text-emerald-600"
      }
    >
      {KIND_LABEL[kind]}
    </Badge>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---- form state ----

type RuleForm = {
  enabled: boolean;
  kind: AssetInterceptKind;
  pattern: string;
  note: string;
};

const defaultForm = (): RuleForm => ({ enabled: true, kind: "fuzzy_domain", pattern: "", note: "" });

// Light frontend validation (same as the backend: only exact_ip / cidr are format-checked, the rest is left to the backend).
function frontValidate(form: RuleForm): string | null {
  const p = form.pattern.trim();
  if (!p) return tr("匹配内容不能为空", "Pattern is required");
  if (form.kind === "cidr" && !/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(p)) {
    return tr("CIDR 格式无效，形如 192.168.0.0/16", "Invalid CIDR, expected e.g. 192.168.0.0/16");
  }
  return null;
}

// ---- page ----

export default function AssetInterceptPage() {
  const [rules, setRules] = React.useState<AssetInterceptRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AssetInterceptRule | null>(null);
  const [form, setForm] = React.useState<RuleForm>(defaultForm());
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setRules(await api.assetInterceptRules());
    } catch {
      toast.error(tr("加载资产拦截规则失败", "Failed to load asset intercept rules"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  function set(patch: Partial<RuleForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function openNew() {
    setEditing(null);
    setForm(defaultForm());
    setOpen(true);
  }

  function openEdit(rule: AssetInterceptRule) {
    setEditing(rule);
    setForm({ enabled: rule.enabled, kind: rule.kind, pattern: rule.pattern, note: rule.note });
    setOpen(true);
  }

  async function handleSave() {
    const err = frontValidate(form);
    if (err) {
      toast.error(err);
      return;
    }
    const payload = { ...form, pattern: form.pattern.trim() };
    setSaving(true);
    try {
      if (editing) {
        await api.updateAssetInterceptRule(editing.id, payload);
        toast.success(tr("规则已更新", "Rule updated"));
      } else {
        await api.createAssetInterceptRule(payload);
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

  async function handleDelete(rule: AssetInterceptRule) {
    if (
      !window.confirm(tr(`确定删除资产拦截规则「${rule.pattern}」？`, `Delete asset intercept rule "${rule.pattern}"?`))
    )
      return;
    try {
      await api.deleteAssetInterceptRule(rule.id);
      toast.success(tr("规则已删除", "Rule deleted"));
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleToggle(rule: AssetInterceptRule) {
    try {
      await api.toggleAssetInterceptRule(rule.id, !rule.enabled);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const placeholder = KIND_OPTIONS.find((o) => o.value === form.kind)?.placeholder ?? "";

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      {/* header */}
      <div className="flex items-center gap-2.5">
        <BanIcon className="h-5 w-5 shrink-0" />
        <div>
          <h1 className="text-lg font-semibold leading-tight">{tr("资产拦截", "Asset blocking")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tr(
              "全局资产黑名单：命中的域名 / IP / URL / 网段将被拦截，不对其执行任何操作",
              "Global asset blocklist: matching domains / IPs / URLs / ranges are blocked and never acted on",
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {tr(
            "支持全等与模糊匹配的域名 / IP / URL，以及 CIDR 网段；默认内置模糊拦截政府（.gov / .gov.cn）与教育（.edu / .edu.cn）网站",
            "Supports exact and fuzzy matching of domains / IPs / URLs, plus CIDR ranges. Government (.gov / .gov.cn) and education (.edu / .edu.cn) sites are fuzzy-blocked by default",
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
              <BanIcon className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{tr("暂无资产拦截规则", "No asset intercept rules yet")}</p>
              <Button size="sm" variant="outline" onClick={openNew}>
                <PlusIcon className="h-4 w-4" />
                {tr("新建第一条规则", "Create the first rule")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[130px]">{tr("类型", "Type")}</TableHead>
                  <TableHead>{tr("匹配内容", "Pattern")}</TableHead>
                  <TableHead>{tr("备注", "Note")}</TableHead>
                  <TableHead className="w-[64px] text-center">{tr("启用", "Enabled")}</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id} className={!rule.enabled ? "opacity-40" : ""}>
                    <TableCell>
                      <KindBadge kind={rule.kind} />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {rule.pattern}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {rule.builtin && (
                          <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[10px]">
                            {tr("内置", "Built-in")}
                          </Badge>
                        )}
                        <span className="truncate">{rule.note}</span>
                      </div>
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
                          onClick={() => handleDelete(rule)}
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

      {/* editor sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>
              {editing
                ? tr("编辑资产拦截规则", "Edit asset intercept rule")
                : tr("新建资产拦截规则", "New asset intercept rule")}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {tr("命中此规则的目标资产会被全局拦截", "Target assets matching this rule are blocked globally")}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
            <Field label={tr("匹配类型", "Match type")}>
              <Select value={form.kind} onValueChange={(v) => set({ kind: v as AssetInterceptKind })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_GROUPS.map((g) => (
                    <React.Fragment key={g}>
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {g}
                      </div>
                      {KIND_OPTIONS.filter((o) => o.group === g).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </React.Fragment>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={tr("匹配内容", "Pattern")}
              hint={
                form.kind === "cidr"
                  ? tr("CIDR 网段，形如 192.168.0.0/16", "CIDR range, e.g. 192.168.0.0/16")
                  : form.kind.startsWith("fuzzy_")
                    ? tr("模糊匹配：目标包含此内容即命中", "Fuzzy match: hits when the target contains this text")
                    : tr("全等匹配：目标需与此内容完全一致", "Exact match: the target must equal this text")
              }
            >
              <Input
                placeholder={placeholder}
                value={form.pattern}
                onChange={(e) => set({ pattern: e.target.value })}
              />
            </Field>

            <Field label={tr("备注（可选）", "Note (optional)")}>
              <Textarea
                placeholder={tr("说明这条规则的用途", "What this rule is for")}
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
                rows={2}
                className="resize-none"
              />
            </Field>

            <Separator />

            <div className="flex items-center gap-3">
              <Switch id="asset-rule-enabled" checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
              <Label htmlFor="asset-rule-enabled" className="cursor-pointer">
                {tr("启用此规则", "Enable this rule")}
              </Label>
            </div>
          </div>

          <SheetFooter className="border-t px-6 py-4 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("取消", "Cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? tr("保存中…", "Saving…") : tr("保存", "Save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
