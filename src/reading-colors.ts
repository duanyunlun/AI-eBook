export type ReadingColors = { mode: "original" | "comfort" | "night"; pdf: boolean; strength: number };

export function normalizeReadingColors(value: Partial<ReadingColors> | null): ReadingColors {
  return {
    mode: value?.mode === "comfort" || value?.mode === "night" ? value.mode : "original",
    pdf: value?.pdf === true,
    strength: typeof value?.strength === "number" && Number.isFinite(value.strength) ? Math.min(100, Math.max(0, value.strength)) : 60,
  };
}

export function pdfColorFilter({ mode, pdf, strength }: ReadingColors): string {
  if (!pdf || mode === "original" || strength === 0) return "none";
  const amount = strength / 100;
  return mode === "night"
    ? `invert(1) hue-rotate(180deg) brightness(${1 - amount * 0.3}) contrast(${1 - amount * 0.25})`
    : `sepia(${amount * 0.25}) brightness(${1 - amount * 0.2})`;
}

export function setupReadingColors(panel: HTMLElement): void {
  const key = "reading-colors";
  let settings = normalizeReadingColors(null);
  try { settings = normalizeReadingColors(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { settings = normalizeReadingColors(null); }
  const mode = panel.querySelector<HTMLSelectElement>("#reading-color-mode")!;
  const pdf = panel.querySelector<HTMLInputElement>("#reading-color-pdf")!;
  const strength = panel.querySelector<HTMLInputElement>("#reading-color-strength")!;
  const output = panel.querySelector<HTMLOutputElement>("#reading-color-value")!;
  const apply = (): void => {
    document.documentElement.dataset.readingColor = settings.mode;
    document.documentElement.style.setProperty("--pdf-color-filter", pdfColorFilter(settings));
    strength.disabled = !settings.pdf || settings.mode === "original";
    output.textContent = `${settings.strength}%`;
  };
  mode.value = settings.mode;
  pdf.checked = settings.pdf;
  strength.value = String(settings.strength);
  const update = (): void => {
    settings = normalizeReadingColors({ mode: mode.value as ReadingColors["mode"], pdf: pdf.checked, strength: strength.valueAsNumber });
    localStorage.setItem(key, JSON.stringify(settings));
    apply();
  };
  mode.addEventListener("change", update);
  pdf.addEventListener("change", update);
  strength.addEventListener("input", update);
  apply();
}
