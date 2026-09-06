export type ReadingColors = { mode: "original" | "comfort" | "night" | "custom"; pdf: boolean; strength: number; background?: string };

export function normalizeReadingColors(value: Partial<ReadingColors> | null): ReadingColors {
  return {
    mode: value?.mode === "comfort" || value?.mode === "night" || value?.mode === "custom" ? value.mode : "original",
    background: typeof value?.background === "string" && /^#[\da-f]{6}$/i.test(value.background) ? value.background : "#dce5dc",
    pdf: value?.pdf === true,
    strength: typeof value?.strength === "number" && Number.isFinite(value.strength) ? Math.min(100, Math.max(0, value.strength)) : 60,
  };
}

export function pdfColorFilter({ mode, pdf, strength }: ReadingColors): string {
  if (pdf && mode === "custom") return "url(#reading-pdf-custom)";
  if (!pdf || mode === "original" || strength === 0) return "none";
  const amount = strength / 100;
  return mode === "night"
    ? `invert(1) hue-rotate(180deg) brightness(${1 - amount * 0.3}) contrast(${1 - amount * 0.25})`
    : `sepia(${amount * 0.25}) brightness(${1 - amount * 0.2})`;
}

export function customReadingPalette(background: string): { ink: string; matrix: string } {
  const channels = background.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const ink = luminance > 0.179 ? 0 : 1;
  return {
    ink: ink ? "#ffffff" : "#000000",
    matrix: channels.map((value, index) => [...channels.map((_, column) => column === index ? value - ink : 0), 0, ink].join(" ")).join(" ") + " 0 0 0 1 0",
  };
}

export function setupReadingColors(panel: HTMLElement): void {
  const key = "reading-colors";
  let settings = normalizeReadingColors(null);
  try { settings = normalizeReadingColors(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { settings = normalizeReadingColors(null); }
  const mode = panel.querySelector<HTMLSelectElement>("#reading-color-mode")!;
  const pdf = panel.querySelector<HTMLInputElement>("#reading-color-pdf")!;
  const strength = panel.querySelector<HTMLInputElement>("#reading-color-strength")!;
  const output = panel.querySelector<HTMLOutputElement>("#reading-color-value")!;
  const background = panel.querySelector<HTMLInputElement>("#reading-color-background")!;
  if (!document.getElementById("reading-pdf-custom")) {
    const filters = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    filters.setAttribute("width", "0"); filters.setAttribute("height", "0");
    filters.setAttribute("aria-hidden", "true");
    filters.style.position = "absolute";
    filters.innerHTML = '<defs><filter id="reading-pdf-custom" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" /></filter></defs>';
    document.body.append(filters);
  }
  const apply = (): void => {
    const palette = customReadingPalette(settings.background!);
    document.documentElement.dataset.readingColor = settings.mode;
    document.documentElement.style.setProperty("--reading-custom-paper", settings.background!);
    document.documentElement.style.setProperty("--reading-custom-ink", palette.ink);
    document.querySelector("#reading-pdf-custom feColorMatrix")!.setAttribute("values", palette.matrix);
    document.documentElement.style.setProperty("--pdf-color-filter", pdfColorFilter(settings));
    strength.disabled = !settings.pdf || settings.mode === "original" || settings.mode === "custom";
    output.textContent = `${settings.strength}%`;
  };
  mode.value = settings.mode;
  pdf.checked = settings.pdf;
  strength.value = String(settings.strength);
  background.value = settings.background!;
  const update = (): void => {
    settings = normalizeReadingColors({ mode: mode.value as ReadingColors["mode"], pdf: pdf.checked, strength: strength.valueAsNumber, background: background.value });
    localStorage.setItem(key, JSON.stringify(settings));
    apply();
  };
  mode.addEventListener("change", update);
  pdf.addEventListener("change", update);
  strength.addEventListener("input", update);
  background.addEventListener("input", () => { mode.value = "custom"; update(); });
  apply();
}
