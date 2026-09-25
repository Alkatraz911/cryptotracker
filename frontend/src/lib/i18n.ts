import { useSyncExternalStore } from "react";
import { EN } from "./i18n.en";

// Two languages, gettext-style: the Russian text IS the key, so a string that
// hasn't been translated yet still renders (in Russian) instead of showing a
// key. Call tr() at render time — never at module load — or a language switch
// won't reach constants captured on import.
export type Lang = "ru" | "en";

const KEY = "ct_lang";
const LANGS: Lang[] = ["ru", "en"];

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* private mode */ }
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

export function applyLang(): void {
  document.documentElement.lang = current;
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// tr("Найдено {n} переводов", { n: 12 }) — placeholders are named so a
// translation can reorder them.
export function tr(ru: string, vars?: Record<string, string | number>): string {
  const s = current === "en" ? (EN[ru] ?? ru) : ru;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Locale for dates and numbers, so a switch to English also changes
// "22.01.24, 19:56" into "1/22/24, 7:56 PM".
export const locale = (): string => (current === "en" ? "en-US" : "ru-RU");

// Subscribe a component to language changes. App calls it at the root, so a
// switch re-renders the whole tree; components that memoize text call it too
// and put `lang` in their dependency list.
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}
