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

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
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
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const stored = localStorage.getItem("theme");
      const t: Theme = isTheme(stored) ? stored : "system";
      const dark = t === "dark" || (t === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage disabled: the theme still applies for this page.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    const dark =
      next === "dark" ||
      (next === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
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