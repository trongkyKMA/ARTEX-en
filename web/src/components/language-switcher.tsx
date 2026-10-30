"use client";

import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLocale, LOCALES, type Locale, setLocale, tr } from "@/lib/i18n";

export function LanguageSwitcher({ className }: { readonly className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label={tr("切换语言", "Change language")}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={getLocale()} onValueChange={(v) => setLocale(v as Locale)}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value}>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
