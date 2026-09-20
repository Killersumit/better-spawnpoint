/**
 * Theme provider.
 *
 * Accessibility notes baked in:
 *  • Respects `prefers-color-scheme` when the user has not chosen explicitly
 *    (WCAG 2.2 does not require dark mode, but forced light mode on a
 *    high-contrast/dark-mode user is a real complaint driver).
 *  • Theme choice is a "functional" cookie category: it is stored in
 *    localStorage, which the cookie policy lists, and it is gated so it only
 *    persists once the visitor allows functional storage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { readConsent } from "@/lib/consent";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  /** Resolved theme after applying `system`. */
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  /** False when the app is intentionally locked to one theme. */
  switchable: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "theme";

function systemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  switchable = true,
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}) {
  const [theme, setThemeState] = useState<Theme>(() =>
    switchable ? readStoredTheme() : defaultTheme
  );
  const [system, setSystem] = useState<"light" | "dark">(systemTheme);

  // Follow the OS setting live, not just on load.
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const resolved = theme === "system" ? system : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    // Tells the browser which form controls / scrollbars to render.
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      // Only persist when the visitor has allowed functional storage.
      const consent = readConsent();
      if (consent?.state.functional) {
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* storage unavailable */
        }
      }
    },
    []
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved,
      setTheme,
      toggle: () => setTheme(resolved === "dark" ? "light" : "dark"),
      switchable,
    }),
    [resolved, setTheme, switchable, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
