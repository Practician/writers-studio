/** Клиентские настройки LLM: провайдер + ключи в localStorage (только этот браузер). */

export type LlmProviderChoice = "auto" | "gemini" | "nvidia" | "groq" | "openrouter";

export interface StoredLlmKeys {
  gemini: string;
  nvidia: string;
  groq: string;
  openrouter: string;
}

const PROVIDER_LS = "writers_studio_llm_provider";
const KEYS_LS = "writers_studio_llm_keys_v1";
/** Одноразовая миграция: старый default NVIDIA → auto (Groq-first). */
const PROVIDER_MIGRATE_V3 = "writers_studio_llm_provider_v3_groq_first";

export const EMPTY_LLM_KEYS: StoredLlmKeys = {
  gemini: "",
  nvidia: "",
  groq: "",
  openrouter: "",
};

export function loadLlmProvider(): LlmProviderChoice {
  const saved = localStorage.getItem(PROVIDER_LS);

  // Раньше UI/env часто оставляли «nvidia» — запросы шли в deepseek 60с×N, игнорируя Groq.
  if (!localStorage.getItem(PROVIDER_MIGRATE_V3)) {
    localStorage.setItem(PROVIDER_MIGRATE_V3, "1");
    if (!saved || saved === "nvidia") {
      localStorage.setItem(PROVIDER_LS, "auto");
      return "auto";
    }
  }

  if (
    saved === "gemini"
    || saved === "nvidia"
    || saved === "auto"
    || saved === "groq"
    || saved === "openrouter"
  ) {
    return saved;
  }
  return "auto";
}

export function saveLlmProvider(provider: LlmProviderChoice): void {
  localStorage.setItem(PROVIDER_LS, provider);
}

export function loadLlmKeys(): StoredLlmKeys {
  try {
    const raw = localStorage.getItem(KEYS_LS);
    if (!raw) return { ...EMPTY_LLM_KEYS };
    const parsed = JSON.parse(raw) as Partial<StoredLlmKeys>;
    return {
      gemini: String(parsed.gemini || ""),
      nvidia: String(parsed.nvidia || ""),
      groq: String(parsed.groq || ""),
      openrouter: String(parsed.openrouter || ""),
    };
  } catch {
    return { ...EMPTY_LLM_KEYS };
  }
}

export function saveLlmKeys(keys: StoredLlmKeys): void {
  localStorage.setItem(KEYS_LS, JSON.stringify({
    gemini: keys.gemini.trim(),
    nvidia: keys.nvidia.trim(),
    groq: keys.groq.trim(),
    openrouter: keys.openrouter.trim(),
  }));
}

export function clearLlmKeys(): void {
  localStorage.removeItem(KEYS_LS);
}

/** Поля для body запросов /api/writer/* — UI-ключи перекрывают .env на сервере только в рамках запроса. */
export function llmRequestFields(
  provider: LlmProviderChoice,
  keys: StoredLlmKeys,
  model?: string,
): {
  llmProvider: LlmProviderChoice;
  model?: string;
  apiKeys: {
    gemini?: string;
    nvidia?: string;
    groq?: string;
    openrouter?: string;
  };
} {
  const apiKeys: {
    gemini?: string;
    nvidia?: string;
    groq?: string;
    openrouter?: string;
  } = {};
  if (keys.gemini.trim()) apiKeys.gemini = keys.gemini.trim();
  if (keys.nvidia.trim()) apiKeys.nvidia = keys.nvidia.trim();
  if (keys.groq.trim()) apiKeys.groq = keys.groq.trim();
  if (keys.openrouter.trim()) apiKeys.openrouter = keys.openrouter.trim();

  return {
    llmProvider: provider,
    ...(model ? { model } : {}),
    apiKeys,
  };
}

export function defaultModelForProvider(
  provider: LlmProviderChoice,
  status?: {
    nvidiaDefaultModel?: string;
    groqDefaultModel?: string;
    openrouterDefaultModel?: string;
  } | null,
): string {
  if (provider === "nvidia") {
    return status?.nvidiaDefaultModel || "deepseek-ai/deepseek-v4-flash";
  }
  if (provider === "groq") {
    return status?.groqDefaultModel || "llama-3.3-70b-versatile";
  }
  if (provider === "openrouter") {
    return status?.openrouterDefaultModel || "openrouter/free";
  }
  if (provider === "gemini") return "gemini-3.5-flash";
  // auto — Gemini первым: лучший результат максимального humanize-бенчмарка.
  return "gemini-3.5-flash";
}

export function providerLabel(provider: LlmProviderChoice): string {
  switch (provider) {
    case "nvidia": return "NVIDIA";
    case "gemini": return "Gemini";
    case "groq": return "Groq";
    case "openrouter": return "OpenRouter";
    case "auto": return "Автовыбор";
  }
}
