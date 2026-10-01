import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeAccent = "blue" | "teal" | "coral";

type ThemeContextValue = {
  mode: ThemeMode;
  accent: ThemeAccent;
  resolvedMode: Exclude<ThemeMode, "system">;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
};

const MODE_KEY = "zchat-theme-mode";
const ACCENT_KEY = "zchat-theme-accent";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isThemeAccent(value: string | null): value is ThemeAccent {
  return value === "blue" || value === "teal" || value === "coral";
}

function getStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(MODE_KEY);
  return isThemeMode(stored) ? stored : "system";
}

function getStoredAccent(): ThemeAccent {
  if (typeof window === "undefined") return "blue";
  const stored = window.localStorage.getItem(ACCENT_KEY);
  return isThemeAccent(stored) ? stored : "blue";
}

function systemMode(): Exclude<ThemeMode, "system"> {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [accent, setAccentState] = useState<ThemeAccent>(getStoredAccent);
  const [systemPreference, setSystemPreference] = useState(systemMode);
  const resolvedMode = mode === "system" ? systemPreference : mode;

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemPreference(query.matches ? "light" : "dark");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = resolvedMode;
    root.dataset["accent"] = accent;
    root.style.colorScheme = resolvedMode;

    const themeColor = getComputedStyle(root).getPropertyValue("--background").trim();
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", themeColor);
  }, [resolvedMode, accent]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      accent,
      resolvedMode,
      setMode: (nextMode) => {
        window.localStorage.setItem(MODE_KEY, nextMode);
        setModeState(nextMode);
      },
      setAccent: (nextAccent) => {
        window.localStorage.setItem(ACCENT_KEY, nextAccent);
        setAccentState(nextAccent);
      },
    }),
    [mode, accent, resolvedMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

export const themeBootScript = `(() => {
  try {
    const savedMode = localStorage.getItem('${MODE_KEY}');
    const mode = savedMode === 'light' || savedMode === 'dark' ? savedMode : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const savedAccent = localStorage.getItem('${ACCENT_KEY}');
    const accent = savedAccent === 'teal' || savedAccent === 'coral' ? savedAccent : 'blue';
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.accent = accent;
    document.documentElement.style.colorScheme = mode;
  } catch (_) {}
})();`;