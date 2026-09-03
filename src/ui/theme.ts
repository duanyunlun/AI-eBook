export type Theme = "light" | "dark";

export type AppearanceSettings = {
  lightAccent: string;
  darkAccent: string;
  fontFamily: string;
  fontSize: number;
};

export type ThemeController = {
  appearance: () => AppearanceSettings;
  setAppearance: (appearance: AppearanceSettings) => void;
};

const appearanceKey = "ui-appearance";
const defaultAppearance: AppearanceSettings = {
  lightAccent: "#087f5b",
  darkAccent: "#55cba1",
  fontFamily: "system",
  fontSize: 14,
};
const systemFont = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const legacyFonts: Record<string, string> = { sans: "PingFang SC", serif: "Songti SC", kai: "Kaiti SC" };

const fontCss = (family: string): string =>
  family === "system" ? systemFont : `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}", ${systemFont}`;

function storedAppearance(): AppearanceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(appearanceKey) ?? "null") as Partial<AppearanceSettings> | null;
    if (stored) {
      return {
        lightAccent: /^#[\da-f]{6}$/i.test(stored.lightAccent ?? "") ? stored.lightAccent! : defaultAppearance.lightAccent,
        darkAccent: /^#[\da-f]{6}$/i.test(stored.darkAccent ?? "") ? stored.darkAccent! : defaultAppearance.darkAccent,
        fontFamily: stored.fontFamily ? legacyFonts[stored.fontFamily] ?? stored.fontFamily : defaultAppearance.fontFamily,
        fontSize: Math.min(18, Math.max(12, Number(stored.fontSize) || defaultAppearance.fontSize)),
      };
    }
  } catch {
    localStorage.removeItem(appearanceKey);
  }
  return { ...defaultAppearance };
}

export function preferredTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemDark ? "dark" : "light";
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

export function setupTheme(button: HTMLButtonElement): ThemeController {
  const themeKey = "app-theme";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let currentTheme = preferredTheme(localStorage.getItem(themeKey), systemTheme.matches);
  let appearance = storedAppearance();

  const applyAppearance = (): void => {
    const accent = currentTheme === "dark" ? appearance.darkAccent : appearance.lightAccent;
    const hoverTarget = currentTheme === "dark" ? "white" : "black";
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-hover", `color-mix(in srgb, ${accent} 82%, ${hoverTarget})`);
    document.documentElement.style.setProperty("--ui-font-family", fontCss(appearance.fontFamily));
    document.documentElement.style.setProperty("--ui-font-scale", String(appearance.fontSize / 14));
  };

  const apply = (theme: Theme, remember = false): void => {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#202321" : "#f7f7f5");
    const target = oppositeTheme(theme);
    button.innerHTML = `<span aria-hidden="true">${target === "dark" ? "☾" : "☀"}</span>${target === "dark" ? "深色" : "浅色"}`;
    button.title = `切换到${target === "dark" ? "深色" : "浅色"}主题`;
    button.setAttribute("aria-label", button.title);
    applyAppearance();
    if (remember) localStorage.setItem(themeKey, theme);
  };

  button.addEventListener("click", () => apply(oppositeTheme(currentTheme), true));
  systemTheme.addEventListener("change", (event) => {
    if (!localStorage.getItem(themeKey)) apply(event.matches ? "dark" : "light");
  });
  apply(currentTheme);
  return {
    appearance: () => ({ ...appearance }),
    setAppearance(next) {
      appearance = next;
      localStorage.setItem(appearanceKey, JSON.stringify(appearance));
      applyAppearance();
    },
  };
}
