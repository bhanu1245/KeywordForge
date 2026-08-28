"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Theme control — System / Light / Dark.
 *
 * Exposed as three explicit buttons rather than a two-state switch because
 * "follow the OS" is a real, and the default, choice. A binary toggle has to
 * silently pick one on first load and then cannot express "go back to
 * automatic", which is the state most people actually want.
 *
 * The applied theme is written to `data-theme` on <html>; globals.css layers
 * the palettes on top of that. Persistence is localStorage, read by the
 * blocking script in layout.tsx before first paint so the page never flashes
 * the wrong theme.
 */

export const THEME_STORAGE_KEY = "kf-theme";

type Theme = "system" | "light" | "dark";

const OPTIONS: Array<{ value: Theme; icon: IconName; label: string }> = [
  { value: "system", icon: "monitor", label: "Match system theme" },
  { value: "light", icon: "sun", label: "Light theme" },
  { value: "dark", icon: "moon", label: "Dark theme" },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function ThemeToggle() {
  // Start as "system" and correct after mount. Rendering the stored value on
  // the server is impossible (localStorage is client-only), and guessing would
  // produce a hydration mismatch.
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // Private mode or blocked storage — "system" is a fine fallback.
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Selection still applies for this session even if it cannot persist.
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {OPTIONS.map((option) => {
        // Before mount every button renders unselected, so the server and
        // client markup agree; the ring appears once we know the real value.
        const active = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => choose(option.value)}
            className={`grid size-6 place-items-center rounded-md transition-colors ${
              active
                ? "bg-elevated text-brand-soft"
                : "text-subtle hover:text-ink"
            }`}
          >
            <Icon name={option.icon} size={13} />
          </button>
        );
      })}
    </div>
  );
}
