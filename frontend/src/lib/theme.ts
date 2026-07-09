// Light/dark theme: persisted in localStorage and applied to <html> via the
// data-theme attribute so all CSS variables flip at once. Dark is the default.
export type Theme = "dark" | "light";

const KEY = "ct_theme";

export function getStoredTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
}

// Call once before React renders to avoid a flash of the wrong theme.
export function initTheme(): Theme {
  const t = getStoredTheme();
  document.documentElement.dataset.theme = t;
  return t;
}
