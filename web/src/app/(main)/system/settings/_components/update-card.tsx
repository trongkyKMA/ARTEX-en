"use client";

import * as React from "react";

import {
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api, sseUrl } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { UpdateCheck, UpdateProgress } from "@/lib/types";

/** Maximum time to wait for the new version to come up. One upgrade goes through three process starts (stage → swap → new version),
 *  each taking seconds; three minutes is enough to cover slow disks and Docker container rebuilds. */
const RESTART_TIMEOUT_MS = 180_000;

function humanSize(n?: number): string {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function UpdateCard() {
  const [info, setInfo] = React.useState<UpdateCheck | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [progress, setProgress] = React.useState<UpdateProgress | null>(null);
  // Separate from progress: once staging completes the process is gone and SSE drops, so switch to polling /api/health.
  const [restarting, setRestarting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // quiet also decides whether to bypass the backend cache: the automatic check on page entry uses the cache (the top bar just checked),
  // while a manual "Check for updates" click forces a fresh lookup, otherwise a just-released version only shows after the cache expires.
  const check = React.useCallback((quiet = false) => {
    setChecking(true);
    api
      .checkUpdate(!quiet)
      .then((r) => {
        setInfo(r);
        if (!quiet) {
          if (r.disabled) toast.info(r.disabled);
          else if (r.error) toast.error(tr("检查更新失败：", "Update check failed: ") + r.error);
          else if (r.has_update) toast.success(tr(`发现新版本 ${r.latest}`, `New version available: ${r.latest}`));
          else if (r.comparable) toast.success(tr("当前已是最新版本", "You are on the latest version"));
        }
      })
      .catch((e) => {
        if (!quiet) toast.error(tr("检查更新失败：", "Update check failed: ") + (e as Error).message);
      })
      .finally(() => setChecking(false));
  }, []);

  React.useEffect(() => {
    check(true);
  }, [check]);

  // Poll /api/health until the version number changes.
  //
  // The criterion must be "the version changed", not "it's reachable again": during the swap the old version briefly starts once more
  // (that run only swaps artex.new in and exits immediately), so looking only at connectivity would misjudge success.
  const waitForNewVersion = React.useCallback(async (fromVersion: string) => {
    setRestarting(true);
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { version?: string };
          if (j.version && j.version !== fromVersion) {
            toast.success(tr(`已更新到 ${j.version}，正在重新加载页面`, `Updated to ${j.version}, reloading the page`));
            await sleep(800);
            window.location.reload();
            return;
          }
        }
      } catch {
        // Being unreachable during the restart window is expected; keep polling.
      }
    }
    setRestarting(false);
    toast.error(
      tr(
        "等待服务重启超时。请检查后端日志，或确认 artex 是通过 start.sh / start.bat 启动的。",
        "Timed out waiting for the service to restart. Check the backend logs, or make sure artex was started via start.sh / start.bat.",
      ),
    );
  }, []);

  // Subscribe to update progress. SSE doesn't go through Next's /api rewrite (that layer buffers, so events can't get through).
  const openStream = React.useCallback(
    (fromVersion: string) => {
      const es = new EventSource(sseUrl("/api/update/stream"));
      es.onmessage = (ev) => {
        let p: UpdateProgress;
        try {
          p = JSON.parse(ev.data) as UpdateProgress;
        } catch {
          return;
        }
        setProgress(p);
        if (p.phase === "failed") {
          es.close();
          setBusy(false);
          toast.error(tr("更新失败：", "Update failed: ") + (p.error || p.message));
          return;
        }
        if (p.phase === "staged") {
          es.close();
          void waitForNewVersion(fromVersion);
        }
      };
      es.onerror = () => {
        // SSE always disconnects when the process exits. If we are already waiting for the restart this is normal,
        // and the /api/health polling continues the judgement.
        es.close();
      };
      return es;
    },
    [waitForNewVersion],
  );

  const doUpdate = () => {
    if (!info) return;
    const from = info.current;
    const ok = window.confirm(
      tr(`确定更新到 ${info.latest}？\n\n`, `Update to ${info.latest}?\n\n`) +
        tr(
          "更新会重启程序，正在运行的任务会被中断。\n",
          "The update restarts the program and interrupts running tasks.\n",
        ) +
        (info.mode === "docker"
          ? tr(
              "\n注意：容器内更新只替换程序本身，不会更新镜像里的 playwright / nmap 等工具链；" +
                "若新版本依赖新工具，请改用 docker compose pull。",
              "\nNote: an in-container update only replaces the program itself, not the playwright / nmap toolchain in the image; " +
                "if the new version needs new tools, use docker compose pull instead.",
            )
          : ""),
    );
    if (!ok) return;

    setBusy(true);
    setProgress({ phase: "downloading", percent: 0, message: tr("准备中…", "Preparing…") });
    const es = openStream(from);
    api.applyUpdate().catch((e) => {
      es.close();
      setBusy(false);
      setProgress(null);
      toast.error(tr("启动更新失败：", "Failed to start update: ") + (e as Error).message);
    });
  };

  const doRollback = () => {
    if (!info) return;
    if (
      !window.confirm(
        tr(
          "回滚到上一版本？\n\n程序会重启，正在运行的任务会被中断。\n注意：数据库结构不会回退，旧版本可能无法识别新版写入的数据。",
          "Roll back to the previous version?\n\nThe program will restart and running tasks will be interrupted.\nNote: the database schema is not rolled back, so the old version may not understand data written by the new one.",
        ),
      )
    )
      return;
    const from = info.current;
    setBusy(true);
    api
      .rollbackUpdate()
      .then(() => {
        toast.success(tr("已切换到上一版本，正在重启…", "Switched to the previous version, restarting…"));
        void waitForNewVersion(from);
      })
      .catch((e) => {
        setBusy(false);
        toast.error(tr("回滚失败：", "Rollback failed: ") + (e as Error).message);
      });
  };

  const phase = progress?.phase;
  const showProgress = busy || restarting;
  // Only the download phase has a real percentage (computed from Content-Length). Verify/extract/wait-for-restart are
  // phases of unknown duration; the progress bar fills up with a pulse animation meaning "busy, but can't say how long".
  const downloading = !restarting && phase === "downloading";
  const pct = downloading ? Math.max(progress?.percent ?? 0, 0) : 100;

  return (
    // The settings page is a multi-column masonry layout; cards handle their own row spacing and forbid breaking across columns (see the comment in page.tsx).
    <Card className="mb-4 break-inside-avoid md:mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DownloadIcon className="size-4" />
          {tr("版本与更新", "Version & updates")}
        </CardTitle>
        <CardDescription>
          {tr(
            "从 GitHub 检查并安装新版本。更新会重启程序，正在运行的任务会被中断。",
            "Check for and install new versions from GitHub. Updating restarts the program and interrupts running tasks.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{tr("当前版本", "Current version")}</span>
          <Badge variant="secondary" className="font-mono">
            {info?.current ?? "…"}
          </Badge>
          {info && (
            <>
              <Badge variant="outline" className="font-mono">
                {info.os}/{info.arch}
              </Badge>
              <Badge variant="outline">{info.mode === "docker" ? "Docker" : tr("独立程序", "Standalone")}</Badge>
            </>
          )}
          {info?.latest && (
            <>
              <span className="text-muted-foreground">{tr("最新版本", "Latest version")}</span>
              <Badge variant={info.has_update ? "default" : "secondary"} className="font-mono">
                {info.latest}
              </Badge>
            </>
          )}
          {info?.html_url && (
            <a
              href={info.html_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {tr("更新日志", "Changelog")} <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>

        {info?.boot_notice && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {info.boot_notice}
          </p>
        )}

        {info?.disabled && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {info.disabled}
          </p>
        )}

        {info?.error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {tr(`无法连接 GitHub：${info.error}`, `Cannot reach GitHub: ${info.error}`)}
            {tr("　可在上方配置全局代理后重试。", " You can configure the global proxy above and retry.")}
          </p>
        )}

        {info && !info.comparable && info.reason && <p className="text-xs text-muted-foreground">{info.reason}</p>}

        {info?.has_update && info.asset_available === false && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {tr(
              `${info.latest} 没有提供 ${info.os}/${info.arch} 的发布包（缺少 ${info.asset}），无法自动更新。`,
              `${info.latest} has no release package for ${info.os}/${info.arch} (missing ${info.asset}), so it cannot be updated automatically.`,
            )}
          </p>
        )}

        {info?.has_update && info.asset_available !== false && (
          <p className="text-xs text-muted-foreground">
            {tr("将下载 ", "Will download ")}
            <span className="font-mono">{info.asset}</span>
            {info.size ? tr(`（${humanSize(info.size)}）`, ` (${humanSize(info.size)})`) : ""}
            {tr(
              "，校验 SHA256 并冒烟测试后才会替换，失败自动保留当前版本。",
              ". It replaces the current version only after the SHA256 check and a smoke test pass; on failure the current version is kept.",
            )}
          </p>
        )}

        {info && !info.has_update && info.comparable && !info.error && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2Icon className="size-3.5 text-emerald-600" />
            {tr("当前已是最新版本。", "You are on the latest version.")}
          </p>
        )}

        {info?.mode === "docker" && info.has_update && (
          <p className="text-xs text-muted-foreground">
            {tr(
              "Docker 下的更新只替换程序本身，不更新镜像里的 playwright / nmap 等工具链，且",
              "Under Docker the update only replaces the program itself, not the playwright / nmap toolchain in the image, and",
            )}
            <span className="font-mono"> docker compose up -d </span>
            {tr(
              "重建容器后会退回镜像自带的版本。需要连镜像一起升级请执行",
              "recreating the container reverts to the version bundled in the image. To upgrade the image too, run",
            )}
            <span className="font-mono"> docker compose pull artex &amp;&amp; docker compose up -d artex</span>
            {tr("。", ".")}
          </p>
        )}

        {showProgress && (
          <div className="space-y-1.5">
            <Progress value={pct} className={downloading ? undefined : "animate-pulse"} />
            <p className="text-xs text-muted-foreground">
              {restarting
                ? tr(
                    "正在重启并应用新版本，请稍候（页面会自动刷新）…",
                    "Restarting and applying the new version, please wait (the page reloads automatically)…",
                  )
                : progress?.message}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => check(false)} disabled={checking || busy || restarting}>
            <RefreshCwIcon className={checking ? "size-4 animate-spin" : "size-4"} />
            {tr("检查更新", "Check for updates")}
          </Button>
          <Button
            size="sm"
            onClick={doUpdate}
            disabled={busy || restarting || !info?.has_update || info?.asset_available === false}
          >
            <DownloadIcon className="size-4" />
            {info?.has_update ? tr(`更新到 ${info.latest}`, `Update to ${info.latest}`) : tr("立即更新", "Update now")}
          </Button>
          {info?.has_backup && (
            <Button variant="ghost" size="sm" onClick={doRollback} disabled={busy || restarting}>
              <RotateCcwIcon className="size-4" />
              {tr("回滚到上一版本", "Roll back to previous version")}
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {tr(
            "一键更新依赖守护脚本重启程序。请通过 ",
            "One-click update relies on the supervisor script to restart the program. Start ARTEX via ",
          )}
          <span className="font-mono">start.sh</span>
          {tr("（Windows 为", " (on Windows,")}
          <span className="font-mono"> start.bat</span>
          {tr(
            "）启动 ARTEX；直接运行 artex 本体时，程序退出后不会被自动拉起。",
            "); if you run the artex binary directly, it will not be restarted after it exits.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}
