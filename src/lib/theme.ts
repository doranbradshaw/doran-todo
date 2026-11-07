/**
 * Colour themes. Each theme is just a block of CSS variables in styles.css —
 * this file only decides which one the page is wearing and remembers the
 * choice on this device.
 *
 * TO MAKE ONE THE PERMANENT DEFAULT: change DEFAULT_THEME below.
 * (Anyone who has already tapped the toggle keeps their own choice until
 * they tap it again.)
 */
export const THEMES = ["orange", "green"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "green";

export const THEME_KEY = "doran-task-board-theme";

export const THEME_LABEL: Record<Theme, string> = {
  orange: "Orange",
  green: "Green",
};

function isTheme(value: unknown): value is Theme {
  return value === "orange" || value === "green";
}

export function loadTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* storage blocked — fall through to the default */
  }
  return DEFAULT_THEME;
}

export function saveTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Paint the theme by tagging <html data-theme="…">; the CSS does the rest. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === "orange" ? "green" : "orange";
}
