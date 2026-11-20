"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABELS: Record<Theme, string> = {
  system: "System theme (click for light)",
  light: "Light theme (click for dark)",
  dark: "Dark theme (click for system)",
};

function isTheme(v: string | null): v is Theme {
  return v === "system" || v === "light" || v === "dark";
}

const CHANGE_EVENT = "theme-change";

/**
 * The choice made on this page, used when storage is unavailable (disabled,
 * or blocked in some private modes) so the toggle still cycles.
 */
let memoryTheme: Theme | null = null;

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (isTheme(stored)) return stored;
  } catch {
    // Storage unavailable: fall back to this page's choice.
  }
  return memoryTheme ?? "system";
}

function writeTheme(theme: Theme): void {
  memoryTheme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Theme changes in this tab and others (for useSyncExternalStore). */
function subscribeTheme(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "theme") onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export default function ThemeToggle() {
  // "system" on the server and during hydration, then the stored choice.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);

  useEffect(() => {
    // Follows the OS setting while on "system", and other tabs' changes.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(readTheme());
    apply();
    mq.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    writeTheme(next);
    applyTheme(next);
  }

  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={cycle}
      title={LABELS[theme]}
      aria-label={`Switch theme (currently ${theme})`}
      className="fixed right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white/80 text-zinc-600 shadow-sm backdrop-blur transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}