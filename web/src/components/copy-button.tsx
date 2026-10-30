"use client";

import * as React from "react";

import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { cn, copyText } from "@/lib/utils";

type CopyButtonProps = {
  // Text to copy; the button is disabled when empty.
  text: string | null | undefined;
  // Toast text after a successful copy, default "Copied".
  successMessage?: string;
  label?: React.ReactNode;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
};

// CopyButton is the unified "copy to clipboard" button: built-in success/failure feedback, and automatic fallback
// in non-secure HTTP contexts (see copyText).
export function CopyButton({
  text,
  successMessage = tr("已复制", "Copied"),
  label = tr("复制", "Copy"),
  size = "sm",
  variant = "outline",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast.success(successMessage);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(tr("复制失败，请手动选择文本复制", "Copy failed. Select the text and copy it manually."));
    }
  }

  return (
    <Button type="button" size={size} variant={variant} className={cn(className)} disabled={!text} onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {label}
    </Button>
  );
}
