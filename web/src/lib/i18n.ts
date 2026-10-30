// UI language (zh / en). Strings are written inline as tr("中文", "English") so the
// two versions sit side by side and a missing translation is impossible.
//
// The locale is read once when this module loads; switching it persists the choice
// and reloads the page, so module-level label maps built with tr() stay correct.
// During static-export prerender there is no window, so it falls back to English;
// pages that render text before mount are wrapped in <LocaleGate> to avoid a
// hydration mismatch when the stored locale is zh.

export type Locale = "en" | "zh";

export const LOCALES: readonly { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

const STORAGE_KEY = "artex_locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // localStorage blocked (private mode etc.) — fall through to the browser language.
  }
  return window.navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const current: Locale = detectLocale();

export function getLocale(): Locale {
  return current;
}

export function isZh(): boolean {
  return current === "zh";
}

/** BCP-47 tag for Intl / toLocaleString. */
export function intlLocale(): string {
  return current === "zh" ? "zh-CN" : "en-US";
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore: the switch then only lasts until the next reload.
  }
  window.location.reload();
}

/** Bilingual literal: returns the Chinese text in zh, the English text otherwise. */
export function tr(zh: string, en: string): string {
  return current === "zh" ? zh : en;
}
