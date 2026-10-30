"use client";

import * as React from "react";

import Link from "next/link";

import { ArrowUpCircleIcon } from "lucide-react";

import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";

/**
 * "New version available" hint in the top bar: checks once on full page load and, if there is an update, lights up next to the version number;
 * clicking it goes straight to the "Version & updates" card on the system settings page.
 *
 * The backend caches the GitHub lookup for 30 minutes, so checking on every mount here is safe
 * -- the unauthenticated GitHub API allows only 60 requests/hour/IP; without that cache, opening a few tabs
 * would burn the quota, and then a real update check would fail.
 *
 * Failures are always silent: the top bar is not the place for errors; the user sees the reason by clicking "Check for updates" on the settings page.
 */
export function UpdateBadge() {
  const [latest, setLatest] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    api
      .checkUpdate()
      .then((r) => {
        // has_update already includes the "versions are comparable" check, so dev builds never show this hint.
        if (alive && r.has_update && r.latest) setLatest(r.latest.replace(/^v(?=\d)/, ""));
      })
      .catch(() => {
        // Silent: no network / GitHub rate limiting should not pop errors in the top bar.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!latest) return null;

  return (
    <Link
      href="/system/settings"
      title={tr(`发现新版本 ${latest}，点击前往更新`, `New version ${latest} available. Click to update`)}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs transition-opacity hover:opacity-90"
    >
      {/* Pulsing dot: the top bar is crowded and plain text is easy to miss; the animation makes it visible at a glance. */}
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-primary-foreground" />
      </span>
      <ArrowUpCircleIcon className="size-3.5" />
      <span className="hidden sm:inline">
        {tr("新版本", "New version")} {latest}
      </span>
      <span className="sm:hidden">{tr("新版本", "New version")}</span>
    </Link>
  );
}
