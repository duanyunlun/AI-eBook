import { invoke } from "@tauri-apps/api/core";
import { defaultSummaryPrompt } from "../summary.ts";

type Protocol =
  | "open_ai_chat_completions"
  | "open_ai_responses"
  | "anthropic_messages"
  | "gemini_generate_content";

export type ProviderSettings = {
  protocol: Protocol;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
};

type AiSettings = ProviderSettings & { systemPrompt: string };
type DshStatus = { installed: boolean; version: string | null; source: "managed" | "system" };
type DshUpdateStatus = { current: DshStatus; latestVersion: string; updateAvailable: boolean };

const storageKey = "ai-provider-settings";
const translationLanguageKey = "translation-language";
export const defaultLookupPrompts = {
  translate: "先判断所选内容是否完全为目标语言；只要包含其他语言的词句或中英混杂，就不算完全匹配。完全匹配时改为解释内容，否则完整翻译为目标语言。只输出结果。",
  explain: "解释所选内容及必要背景，区分原文事实与推断。如果当前模型本身具备联网检索能力，可核验相关背景；无法联网时不得声称已经联网。",
};

export const getLookupPrompt = (mode: keyof typeof defaultLookupPrompts): string =>
  localStorage.getItem(`lookup-prompt-${mode}`)?.trim() || defaultLookupPrompts[mode];

export const getLookupInstruction = (mode: keyof typeof defaultLookupPrompts): string =>
  (mode === "translate" ? `目标语言是${getTranslationLanguage()}。` : "") + getLookupPrompt(mode);
const dshRegistryKey = "dsh-registry";
const defaultDshRegistry = "https://registry.npmmirror.com/";
const defaultMaxOutputTokens = 16384;
const defaultSystemPrompt =
  "你是服务于当前阅读作品的中文 AI 伴读助手。优先结合当前作品、阅读位置、用户选区和个人知识库回答；没有足够正文时明确说明信息边界，不要求用户重复提供已经给出的作品信息。";
const defaultBaseUrls: Record<Protocol, string> = {
  open_ai_chat_completions: "https://api.openai.com/v1",
  open_ai_responses: "https://api.openai.com/v1",
  anthropic_messages: "https://api.anthropic.com/v1",
  gemini_generate_content: "https://generativelanguage.googleapis.com/v1beta",
};

function getStoredSettings(): AiSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<AiSettings> | null;
    if (stored?.protocol && stored.baseUrl && typeof stored.model === "string") {
      return {
        protocol: stored.protocol,
        baseUrl: stored.baseUrl,
        model: stored.model,
        maxOutputTokens: Number.isInteger(stored.maxOutputTokens)
          && Number(stored.maxOutputTokens) > 0
          && Number(stored.maxOutputTokens) <= 131072
          ? Number(stored.maxOutputTokens)
          : defaultMaxOutputTokens,
        systemPrompt: stored.systemPrompt?.trim() || defaultSystemPrompt,
      };
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
  return {
    protocol: "open_ai_chat_completions",
    baseUrl: defaultBaseUrls.open_ai_chat_completions,
    model: "",
    maxOutputTokens: defaultMaxOutputTokens,
    systemPrompt: defaultSystemPrompt,
  };
}

export function getAiSettings(): ProviderSettings {
  const { systemPrompt: _, ...provider } = getStoredSettings();
  return provider;
}

export const getCompanionSystemPrompt = (): string => getStoredSettings().systemPrompt;
export const getSummaryPrompt = (): string => localStorage.getItem("summary-prompt")?.trim() || defaultSummaryPrompt;
export const getTranslationLanguage = (): string => localStorage.getItem(translationLanguageKey) || "简体中文";
export const getAiRuntime = (): "direct" | "dsh" => localStorage.getItem("ai-runtime") === "dsh" ? "dsh" : "direct";

export function setupAiSettings(
  openButton: HTMLButtonElement,
  panel: HTMLElement,
  openSettings: () => void,
  closeSettings: () => void,
  vaultPath: HTMLInputElement,
  chooseVault: HTMLButtonElement,
): void {
  const get = <T extends Element>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error(`缺少 AI 设置元素：${selector}`);
    return element;
  };
  const form = get<HTMLFormElement>("#ai-settings-form");
  const promptsForm = get<HTMLFormElement>("#ai-prompts-form");
  const promptsStatus = get<HTMLOutputElement>("#ai-prompts-status");
  const summaryPrompt = get<HTMLTextAreaElement>("#ai-summary-prompt");
  summaryPrompt.value = getSummaryPrompt();
  get<HTMLButtonElement>("#reset-summary-prompt").addEventListener("click", () => {
    summaryPrompt.value = defaultSummaryPrompt;
  });
  const protocol = get<HTMLSelectElement>("#ai-protocol");
  const baseUrl = get<HTMLInputElement>("#ai-base-url");
  const model = get<HTMLInputElement>("#ai-model");
  const maxOutputTokens = get<HTMLInputElement>("#ai-max-output-tokens");
  const translationLanguage = get<HTMLSelectElement>("#translation-language");
  const systemPrompt = get<HTMLTextAreaElement>("#ai-system-prompt");
  get<HTMLButtonElement>("#reset-system-prompt").addEventListener("click", () => {
    systemPrompt.value = defaultSystemPrompt;
  });
  const lookupPrompts = {
    translate: get<HTMLTextAreaElement>("#ai-translate-prompt"),
    explain: get<HTMLTextAreaElement>("#ai-explain-prompt"),
  };
  for (const mode of ["translate", "explain"] as const) {
    lookupPrompts[mode].value = getLookupPrompt(mode);
    get<HTMLButtonElement>(`#reset-${mode}-prompt`).addEventListener("click", () => {
      lookupPrompts[mode].value = defaultLookupPrompts[mode];
    });
  }
  const apiKey = get<HTMLInputElement>("#ai-api-key");
  const status = get<HTMLOutputElement>("#ai-settings-status");
  const testButton = get<HTMLButtonElement>("#ai-test");
  const closeButton = get<HTMLButtonElement>("#settings-close");
  const dshStatus = get<HTMLOutputElement>("#dsh-status");
  const dshRegistry = get<HTMLInputElement>("#dsh-registry");
  const dshUpdate = get<HTMLButtonElement>("#dsh-update");
  const dshProgress = get<HTMLProgressElement>("#dsh-progress");
  const runtime = get<HTMLSelectElement>("#ai-runtime");
  runtime.value = getAiRuntime();
  runtime.addEventListener("change", () => localStorage.setItem("ai-runtime", runtime.value));
  const pluginStatus = get<HTMLOutputElement>("#reader-plugin-status");
  type PluginStatus = { pluginVersion: string; dshVersion?: string; compatible: boolean };
  const showPlugin = (value: PluginStatus): void => {
    pluginStatus.textContent = `阅读器插件 ${value.pluginVersion} · ${!value.dshVersion ? "等待安装 DSH" : value.compatible ? "版本兼容" : "DSH 版本不兼容"}`;
  };
  const refreshPlugin = (): void => {
    void invoke<PluginStatus>("get_reader_runtime_status").then(showPlugin).catch((error) => { pluginStatus.textContent = String(error); });
  };
  for (const [id, command] of [["reader-plugin-import", "import_reader_plugin"], ["reader-plugin-restore", "restore_reader_plugin"]]) {
    const button = get<HTMLButtonElement>(`#${id}`);
    button.addEventListener("click", () => {
      button.disabled = true;
      void invoke<PluginStatus | null>(command).then((value) => { if (value) showPlugin(value); })
        .catch((error) => { pluginStatus.textContent = String(error); }).finally(() => { button.disabled = false; });
    });
  }
  let dshAction: "check" | "update" = "check";
  let dshTimer: number | undefined;

  const setStatus = (message: string, error = false): void => {
    status.textContent = message;
    status.dataset.state = error ? "error" : "normal";
  };
  const values = (): AiSettings => ({
    protocol: protocol.value as Protocol,
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    maxOutputTokens: Number(maxOutputTokens.value),
    systemPrompt: getCompanionSystemPrompt(),
  });
  const providerValues = (): ProviderSettings => {
    const { systemPrompt: _, ...provider } = values();
    return provider;
  };
  const refreshKeyStatus = (): void => {
    void invoke<boolean>("has_ai_api_key", { provider: providerValues() })
      .then((exists) => {
        apiKey.placeholder = exists ? "已保存到系统钥匙串" : "输入 API Key（本地服务可留空）";
      })
      .catch((error) => setStatus(String(error), true));
  };
  const save = async (): Promise<void> => {
    if (!form.reportValidity()) return;
    if (apiKey.value.trim()) {
      await invoke("save_ai_api_key", { provider: providerValues(), apiKey: apiKey.value.trim() });
      apiKey.value = "";
      apiKey.placeholder = "已保存到系统钥匙串";
    }
    localStorage.setItem(storageKey, JSON.stringify(values()));
    setStatus("已保存");
  };
  const busy = (value: boolean): void => {
    for (const button of form.querySelectorAll<HTMLButtonElement>("button")) button.disabled = value;
  };
  const showDshStatus = (current: DshStatus): void => {
    dshStatus.textContent = current.installed
      ? `${current.source === "managed" ? "应用托管" : "系统安装"} · ${current.version}`
      : "未检测到 DSH";
    dshAction = "check";
    dshUpdate.textContent = "检查更新";
    dshUpdate.disabled = false;
  };
  const refreshDsh = (): void => {
    refreshPlugin();
    void invoke<DshStatus>("get_dsh_status")
      .then(showDshStatus)
      .catch((error) => {
        dshStatus.textContent = String(error);
      });
  };

  const initial = getStoredSettings();
  protocol.value = initial.protocol;
  baseUrl.value = initial.baseUrl;
  model.value = initial.model;
  maxOutputTokens.value = String(initial.maxOutputTokens);
  translationLanguage.value = getTranslationLanguage();
  systemPrompt.value = initial.systemPrompt;
  dshRegistry.value = localStorage.getItem(dshRegistryKey) || defaultDshRegistry;
  refreshKeyStatus();

  protocol.addEventListener("change", () => {
    if (Object.values(defaultBaseUrls).includes(baseUrl.value)) {
      baseUrl.value = defaultBaseUrls[protocol.value as Protocol];
    }
    refreshKeyStatus();
  });
  baseUrl.addEventListener("change", refreshKeyStatus);
  promptsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      systemPrompt.value = systemPrompt.value.trim() || defaultSystemPrompt;
      localStorage.setItem(storageKey, JSON.stringify({ ...getStoredSettings(), systemPrompt: systemPrompt.value }));
      for (const mode of ["translate", "explain"] as const) {
        lookupPrompts[mode].value = lookupPrompts[mode].value.trim() || defaultLookupPrompts[mode];
        localStorage.setItem(`lookup-prompt-${mode}`, lookupPrompts[mode].value);
      }
      summaryPrompt.value = summaryPrompt.value.trim() || defaultSummaryPrompt;
      localStorage.setItem("summary-prompt", summaryPrompt.value);
      localStorage.setItem(translationLanguageKey, translationLanguage.value);
      promptsStatus.textContent = "已保存";
    } catch (error) {
      promptsStatus.textContent = `保存失败：${String(error)}`;
    }
  });
  dshRegistry.addEventListener("change", () => {
    if (!dshRegistry.reportValidity()) return;
    localStorage.setItem(dshRegistryKey, dshRegistry.value.trim());
    dshAction = "check";
    dshUpdate.textContent = "检查更新";
    dshUpdate.disabled = false;
  });
  openButton.addEventListener("click", () => {
    openSettings();
    refreshDsh();
    void invoke<string>("get_vault_path").then((path) => {
      vaultPath.value = path;
    });
  });
  dshUpdate.addEventListener("click", () => {
    if (!dshRegistry.reportValidity()) return;
    const registry = dshRegistry.value.trim();
    localStorage.setItem(dshRegistryKey, registry);
    dshUpdate.disabled = true;
    const activity = dshAction === "check" ? "正在检查更新" : "正在下载并安装";
    const startedAt = Date.now();
    dshProgress.hidden = false;
    dshStatus.textContent = `${activity} · 0:00`;
    dshTimer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      dshStatus.textContent = `${activity} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }, 1000);
    const action: Promise<DshUpdateStatus | DshStatus> = dshAction === "check"
      ? invoke<DshUpdateStatus>("check_dsh_update", { registry })
      : invoke<DshStatus>("update_dsh", { registry });
    void action
      .then((result) => {
        if (!("latestVersion" in result)) { refreshPlugin(); return showDshStatus(result); }
        const current = result.current.installed
          ? `${result.current.source === "managed" ? "应用托管" : "系统安装"} ${result.current.version}`
          : "未安装";
        dshStatus.textContent = `当前：${current} · 最新：${result.latestVersion}`;
        if (!result.updateAvailable) {
          dshStatus.textContent += " · 已是最新";
          dshUpdate.textContent = "重新检查";
          dshUpdate.disabled = false;
          return;
        }
        dshAction = "update";
        dshUpdate.textContent = result.current.source === "managed"
          ? `更新到 ${result.latestVersion}`
          : "安装到应用";
        dshUpdate.disabled = false;
      })
      .catch((error) => {
        dshStatus.textContent = String(error);
        dshUpdate.textContent = "重新检查";
        dshAction = "check";
        dshUpdate.disabled = false;
      })
      .finally(() => {
        window.clearInterval(dshTimer);
        dshTimer = undefined;
        dshProgress.hidden = true;
      });
  });
  chooseVault.addEventListener("click", () => {
    chooseVault.disabled = true;
    void invoke<string | null>("choose_vault")
      .then((path) => {
        if (path) vaultPath.value = path;
      })
      .catch((error) => setStatus(String(error), true))
      .finally(() => {
        chooseVault.disabled = false;
      });
  });
  closeButton.addEventListener("click", () => {
    closeSettings();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(true);
    void save()
      .catch((error) => setStatus(String(error), true))
      .finally(() => busy(false));
  });
  testButton.addEventListener("click", () => {
    if (!form.reportValidity()) return;
    busy(true);
    setStatus("正在连接…");
    void save()
      .then(() => invoke<string>("test_ai_provider", { provider: providerValues() }))
      .then((reply) => setStatus(`连接成功：${reply.trim() || "已收到响应"}`))
      .catch((error) => setStatus(String(error), true))
      .finally(() => busy(false));
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.getAttribute("aria-hidden") === "false") closeSettings();
  });
}
