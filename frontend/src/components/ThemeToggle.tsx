import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "pilot-efb-theme";

function savedTheme(): Theme | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Follows the device's light or dark setting until the pilot picks one here.
 * The choice is remembered on this device only.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? systemTheme());

  useEffect(() => {
    if (!savedTheme()) return;
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private browsing); the choice then lasts until reload.
    }
    setTheme(next);
  };

  return (
    <button
      aria-pressed={theme === "dark"}
      className="button button--secondary theme-toggle"
      onClick={toggle}
      type="button"
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
