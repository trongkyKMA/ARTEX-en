"use client";

import * as React from "react";

import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Finding, FindingsPage } from "@/lib/types";

export function LinkTrafficDialog({
  trafficIds,
  onClose,
  onBound,
}: {
  trafficIds: string[];
  onClose: () => void;
  onBound: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<FindingsPage | null>(null);
  const [selected, setSelected] = React.useState<Finding | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api
        .findingsPage({ page, pageSize: 20, query })
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e: Error) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, page]);
  async function save() {
    if (!selected?.finding_id) return;
    setBusy(true);
    setError("");
    try {
      await api.bindFindingTraffic(
        selected.finding_id,
        trafficIds.map((traffic_id) => ({ traffic_id })),
      );
      toast.success(
        tr(
          `已关联 ${trafficIds.length} 条流量到漏洞 #${selected.finding_id}`,
          `Linked ${trafficIds.length} traffic record(s) to finding #${selected.finding_id}`,
        ),
      );
      onBound();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("关联到漏洞", "Link to finding")}</DialogTitle>
          <DialogDescription>
            {tr(
              `将所选 ${trafficIds.length} 条流量保存为已有漏洞的证据。`,
              `Save the ${trafficIds.length} selected traffic record(s) as evidence on an existing finding.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="link-finding-query">{tr("查找漏洞", "Find finding")}</FieldLabel>
            <Input
              id="link-finding-query"
              placeholder={tr("名称 / 摘要 / 漏洞类别", "Name / summary / vuln class")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </Field>
        </FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex max-h-[40vh] flex-col gap-2 overflow-auto" aria-busy={loading}>
          {(data?.items ?? []).map((f) => (
            <Button
              key={f.finding_id ?? f.id}
              variant={selected?.finding_id === f.finding_id ? "secondary" : "outline"}
              className="h-auto justify-start p-3 text-left whitespace-normal"
              aria-pressed={selected?.finding_id === f.finding_id}
              disabled={busy || !f.finding_id || f.inherited}
              onClick={() => setSelected(f)}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span>
                  #{f.finding_id ?? f.id} · {f.name || f.vulnclass}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{f.summary}</span>
              </span>
            </Button>
          ))}
          {!data?.items.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading
                ? tr("加载中…", "Loading…")
                : tr("没有匹配的漏洞，请先登记漏洞", "No matching findings. Record the finding first")}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>
            {tr("上一页", "Previous")}
          </Button>
          <span className="text-xs">
            {tr(`第 ${page} 页 · 共 ${data?.total ?? 0} 条`, `Page ${page} · ${data?.total ?? 0} total`)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page * 20 >= (data?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            {tr("下一页", "Next")}
          </Button>
        </div>
        <p className="text-sm">
          {selected
            ? tr(
                `已选漏洞：#${selected.finding_id} ${selected.name || selected.vulnclass}`,
                `Selected: #${selected.finding_id} ${selected.name || selected.vulnclass}`,
              )
            : tr("请选择一个漏洞", "Select a finding")}
        </p>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {tr("取消", "Cancel")}
          </Button>
          <Button disabled={busy || !selected} onClick={() => void save()}>
            {busy ? tr("保存中…", "Saving…") : tr("确认关联", "Link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
