"use client";

import * as React from "react";

import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { FindingRetest } from "@/lib/types";

interface FindingRetestDialogProps {
  findingId: string;
  findingName?: string;
  onClose: () => void;
  onStarted?: (retest: FindingRetest) => void;
}

// Mounted only while open, the note is cleared on close; the list and detail views share the submit lock and error handling, and stay on the current page after starting.
export function FindingRetestDialog({ findingId, findingName, onClose, onStarted }: FindingRetestDialogProps) {
  const notesId = React.useId();
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const submitLock = React.useRef(false);

  async function start() {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const result = await api.startFindingRetest(findingId, notes.trim());
      onStarted?.(result.retest);
      onClose();
      toast.success(
        result.created
          ? tr("复测已启动，可点击「复测中」查看会话", "Retest started. Click “Retesting” to view the session")
          : tr("该漏洞正在复测，可查看已有会话", "This finding is already being retested. View the existing session"),
      );
    } catch (e) {
      toast.error(tr(`发起复测失败：${(e as Error).message}`, `Failed to start retest: ${(e as Error).message}`));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitLock.current && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("复测漏洞", "Retest finding")} #{findingId}
          </DialogTitle>
          <DialogDescription className="break-words">
            {findingName ? <span className="mb-2 block">{findingName}</span> : null}
            {tr(
              "复测 Agent 将读取原证据和测试约束，在独立会话中执行针对性验证。复测成功完成且确认修复后，漏洞状态自动改为「已修复」，其他结论保留原状态。",
              "The retest agent reads the original evidence and test constraints and runs a targeted check in a separate session. If the retest completes and confirms the fix, the finding is set to “Fixed”; any other outcome keeps the current status.",
            )}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-disabled={submitting}>
            <FieldLabel htmlFor={notesId}>{tr("补充说明（可选）", "Notes (optional)")}</FieldLabel>
            <Textarea
              id={notesId}
              value={notes}
              maxLength={4000}
              rows={4}
              disabled={submitting}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tr(
                "例如：使用原测试账号验证原接口；修复版本为 v2。",
                "e.g. Verify the original endpoint with the original test account; fix shipped in v2.",
              )}
            />
            <FieldDescription>
              {tr(
                "可补充修复版本、测试条件或本次限制。",
                "Add the fix version, test conditions or limits for this run.",
              )}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            {tr("取消", "Cancel")}
          </Button>
          <Button disabled={submitting} onClick={() => void start()}>
            {submitting ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
            {submitting ? tr("正在创建…", "Creating…") : tr("开始复测", "Start retest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
