import { invoke } from "@tauri-apps/api/core";
import type { AppearanceSettings, ThemeController } from "./theme";

export type ShortcutId =
  | "toggleLeft"
  | "toggleRight"
  | "openChapters"
  | "openLibrary"
  | "openKnowledge"
  | "openBook"
  | "openSettings"
  | "think"
  | "record"
  | "translate"
  | "explain"
  | "capture"
  | "sendQueue"
  | "interrupt";

type ShortcutDefinition = {
  id: ShortcutId;
  label: string;
  group: "导航" | "阅读动作" | "AI 对话";
  shortcut: string;
};

const shortcutKey = "keyboard-shortcuts";
const definitions: ShortcutDefinition[] = [
  { id: "toggleLeft", label: "显示 / 隐藏主菜单", group: "导航", shortcut: "Mod+Shift+[" },
  { id: "toggleRight", label: "显示 / 隐藏 AI 伴读", group: "导航", shortcut: "Mod+Shift+]" },
  { id: "openChapters", label: "打开目录", group: "导航", shortcut: "Mod+Shift+C" },
  { id: "openLibrary", label: "打开书库", group: "导航", shortcut: "Mod+Shift+L" },
  { id: "openKnowledge", label: "打开知识库", group: "导航", shortcut: "Mod+Shift+K" },
  { id: "openBook", label: "打开书籍", group: "导航", shortcut: "Mod+O" },
  { id: "openSettings", label: "打开设置", group: "导航", shortcut: "Mod+," },
  { id: "think", label: "思考所选内容", group: "阅读动作", shortcut: "Alt+A" },
  { id: "record", label: "记录所选内容", group: "阅读动作", shortcut: "Alt+N" },
  { id: "translate", label: "翻译所选内容", group: "阅读动作", shortcut: "Alt+T" },
  { id: "explain", label: "解释所选内容", group: "阅读动作", shortcut: "Alt+E" },
  { id: "capture", label: "截取页面区域", group: "阅读动作", shortcut: "Alt+S" },
  { id: "sendQueue", label: "发送 / 排队", group: "AI 对话", shortcut: "Enter" },
  { id: "interrupt", label: "插队发送", group: "AI 对话", shortcut: "Mod+Enter" },
];

const defaults = (): Record<ShortcutId, string> =>
  Object.fromEntries(definitions.map(({ id, shortcut }) => [id, shortcut])) as Record<ShortcutId, string>;

function storedShortcuts(): Record<ShortcutId, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(shortcutKey) ?? "null") as Partial<Record<ShortcutId, string>> | null;
    return { ...defaults(), ...(stored ?? {}) };
  } catch {
    localStorage.removeItem(shortcutKey);
    return defaults();
  }
}

function eventShortcut(event: KeyboardEvent): string | undefined {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return undefined;
  const codeKeys: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Space: "Space" };
  const key = event.code.startsWith("Key")
    ? event.code.slice(3)
    : event.code.startsWith("Digit")
      ? event.code.slice(5)
      : codeKeys[event.code] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [event.metaKey || event.ctrlKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key]
    .filter(Boolean)
    .join("+");
}

function displayShortcut(shortcut: string): string {
  if (!shortcut) return "未设置";
  const mac = navigator.platform.toLowerCase().includes("mac");
  return shortcut
    .replace("Mod+", mac ? "⌘" : "Ctrl+")
    .replace("Alt+", mac ? "⌥" : "Alt+")
    .replace("Shift+", mac ? "⇧" : "Shift+");
}

export function setupPreferences(
  panel: HTMLElement,
  openButton: HTMLButtonElement,
  questionInput: HTMLTextAreaElement,
  theme: ThemeController,
  actions: Record<ShortcutId, () => void>,
): void {
  const get = <T extends Element>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error(`缺少偏好设置元素：${selector}`);
    return element;
  };
  const tabButtons = [...panel.querySelectorAll<HTMLButtonElement>("[data-settings-tab]")];
  const pages = [...panel.querySelectorAll<HTMLElement>("[data-settings-page]")];
  const shortcutList = get<HTMLElement>("#shortcut-settings");
  const shortcutStatus = get<HTMLOutputElement>("#shortcut-status");
  const resetShortcuts = get<HTMLButtonElement>("#reset-shortcuts");
  const lightAccent = get<HTMLInputElement>("#light-accent");
  const darkAccent = get<HTMLInputElement>("#dark-accent");
  const fontFamily = get<HTMLSelectElement>("#ui-font-family");
  const fontSize = get<HTMLInputElement>("#ui-font-size");
  const fontSizeValue = get<HTMLOutputElement>("#ui-font-size-value");
  let shortcuts = storedShortcuts();
  let recording: ShortcutId | undefined;
  let fontsLoaded = false;

  const loadFonts = (): void => {
    if (fontsLoaded) return;
    fontsLoaded = true;
    const selected = theme.appearance().fontFamily;
    if (selected !== "system") fontFamily.add(new Option(selected, selected));
    fontFamily.value = selected;
    void invoke<string[]>("list_system_fonts")
      .then((families) => {
        fontFamily.replaceChildren(new Option("系统默认", "system"));
        if (selected !== "system" && !families.includes(selected)) fontFamily.add(new Option(selected, selected));
        for (const family of families) fontFamily.add(new Option(family, family));
        fontFamily.value = selected;
      })
      .catch((error) => {
        fontsLoaded = false;
        fontFamily.title = `读取系统字体失败：${String(error)}`;
      });
  };

  const activatePage = (name: string): void => {
    for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset.settingsTab === name));
    for (const page of pages) page.hidden = page.dataset.settingsPage !== name;
    if (name === "appearance") loadFonts();
  };
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => activatePage(button.dataset.settingsTab!));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = (index + (event.key === "ArrowRight" ? 1 : tabButtons.length - 1)) % tabButtons.length;
      tabButtons[next].focus();
      tabButtons[next].click();
    });
  });
  openButton.addEventListener("click", () => {
    const active = tabButtons.find((button) => button.getAttribute("aria-selected") === "true");
    if (active?.dataset.settingsTab === "appearance") loadFonts();
  });

  const renderShortcuts = (): void => {
    shortcutList.replaceChildren();
    for (const groupName of ["导航", "阅读动作", "AI 对话"] as const) {
      const group = document.createElement("section");
      group.className = "shortcut-group";
      const heading = document.createElement("h3");
      heading.textContent = groupName;
      group.append(heading);
      for (const definition of definitions.filter(({ group }) => group === groupName)) {
        const row = document.createElement("label");
        row.className = "shortcut-row";
        const name = document.createElement("span");
        name.textContent = definition.label;
        const binding = document.createElement("button");
        binding.className = "shortcut-binding";
        binding.type = "button";
        binding.textContent = displayShortcut(shortcuts[definition.id]);
        binding.dataset.recording = String(recording === definition.id);
        binding.addEventListener("click", () => {
          recording = definition.id;
          shortcutStatus.textContent = "按下新的组合键，Esc 取消，Delete 清除";
          renderShortcuts();
          shortcutList.querySelector<HTMLButtonElement>(`[data-shortcut-id="${definition.id}"]`)?.focus();
        });
        binding.dataset.shortcutId = definition.id;
        row.append(name, binding);
        group.append(row);
      }
      shortcutList.append(group);
    }
  };

  resetShortcuts.addEventListener("click", () => {
    shortcuts = defaults();
    localStorage.setItem(shortcutKey, JSON.stringify(shortcuts));
    recording = undefined;
    shortcutStatus.textContent = "已恢复默认快捷键";
    renderShortcuts();
  });

  const applyAppearance = (): void => {
    const appearance: AppearanceSettings = {
      lightAccent: lightAccent.value,
      darkAccent: darkAccent.value,
      fontFamily: fontFamily.value as AppearanceSettings["fontFamily"],
      fontSize: fontSize.valueAsNumber,
    };
    fontSizeValue.textContent = `${appearance.fontSize}px`;
    theme.setAppearance(appearance);
  };
  const appearance = theme.appearance();
  lightAccent.value = appearance.lightAccent;
  darkAccent.value = appearance.darkAccent;
  fontFamily.value = appearance.fontFamily;
  fontSize.value = String(appearance.fontSize);
  fontSizeValue.textContent = `${appearance.fontSize}px`;
  lightAccent.addEventListener("input", applyAppearance);
  darkAccent.addEventListener("input", applyAppearance);
  fontFamily.addEventListener("change", applyAppearance);
  fontSize.addEventListener("input", applyAppearance);

  questionInput.addEventListener("keydown", (event) => {
    if (event.isComposing || event.repeat) return;
    const shortcut = eventShortcut(event);
    const definition = definitions.find(({ id }) =>
      (id === "sendQueue" || id === "interrupt") && shortcuts[id] === shortcut);
    if (!definition) return;
    event.preventDefault();
    event.stopPropagation();
    actions[definition.id]();
  });

  window.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (recording) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        recording = undefined;
        shortcutStatus.textContent = "";
        renderShortcuts();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        shortcuts[recording] = "";
      } else {
        const next = eventShortcut(event);
        if (!next) return;
        const conflict = definitions.find(({ id }) => id !== recording && shortcuts[id] === next);
        if (conflict) {
          shortcutStatus.textContent = `与“${conflict.label}”冲突`;
          return;
        }
        shortcuts[recording] = next;
      }
      localStorage.setItem(shortcutKey, JSON.stringify(shortcuts));
      recording = undefined;
      shortcutStatus.textContent = "已更新";
      renderShortcuts();
      return;
    }
    if (event.repeat || panel.getAttribute("aria-hidden") === "false") return;
    const shortcut = eventShortcut(event);
    if (!shortcut) return;
    const definition = definitions.find(({ id }) => shortcuts[id] === shortcut);
    if (!definition) return;
    if (definition.id === "sendQueue" || definition.id === "interrupt") return;
    const editing = event.target instanceof Element && Boolean(event.target.closest("input, textarea, select, [contenteditable='true']"));
    if (editing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    actions[definition.id]();
  }, true);

  renderShortcuts();
}
