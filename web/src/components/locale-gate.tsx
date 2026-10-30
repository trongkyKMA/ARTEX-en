"use client";

import type { ReactNode } from "react";
import * as React from "react";

import { getLocale } from "@/lib/i18n";

// Renders children only after mount. The static-export HTML is prerendered in
// English, so a zh visitor would otherwise hit a hydration mismatch on every tr().
export function LocaleGate({ children }: { readonly children: ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    document.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return <>{children}</>;
}
