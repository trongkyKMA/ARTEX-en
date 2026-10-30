"use client";

import * as React from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { isZh, tr } from "@/lib/i18n";

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // reset fields whenever the dialog closes
  React.useEffect(() => {
    if (!open) {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      toast.error(tr("请填写当前密码和新密码", "Enter your current and new password"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(tr("两次输入的新密码不一致", "The new passwords do not match"));
      return;
    }
    setSaving(true);
    api
      .changePassword(oldPassword, newPassword)
      .then(() => {
        toast.success(tr("密码已修改", "Password changed"));
        onOpenChange(false);
      })
      .catch((err) =>
        toast.error(tr(`修改失败：${(err as Error).message}`, `Change failed: ${(err as Error).message}`)),
      )
      .finally(() => setSaving(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{tr("修改密码", "Change password")}</DialogTitle>
            <DialogDescription>
              {isZh() ? (
                <>
                  用户名固定为 <b>ARTEX</b>。需先输入当前密码验证；修改后已签发的登录 token 仍有效直至过期。
                </>
              ) : (
                <>
                  The username is always <b>ARTEX</b>. Enter your current password to verify. Login tokens already
                  issued stay valid until they expire.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-old">{tr("当前密码", "Current password")}</Label>
              <Input
                id="cp-old"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                disabled={saving}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-new">{tr("新密码", "New password")}</Label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                disabled={saving}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-confirm">{tr("确认新密码", "Confirm new password")}</Label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                disabled={saving}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {tr("取消", "Cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? tr("修改中…", "Saving…") : tr("确认修改", "Change password")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
