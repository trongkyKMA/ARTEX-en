import type { ReactNode } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleGate } from "@/components/locale-gate";

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <LocaleGate>
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>
      {children}
    </LocaleGate>
  );
}
