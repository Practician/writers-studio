// Унифицированный вызов LLM: Gemini, NVIDIA NIM, Groq, OpenRouter.
//
// Ключи: .env И/ИЛИ apiKeys из UI (localStorage → body запроса).
// UI-ключи живут только в браузере; сервер использует их в AsyncLocalStorage на время запроса.
//
// Env:
//   GEMINI_API_KEY[_2|_3], NVIDIA_API_KEY[_2], GROQ_API_KEY, OPENROUTER_API_KEY
//   LLM_PROVIDER = gemini | nvidia | groq | openrouter | auto
//   NVIDIA_*, GROQ_DEFAULT_MODEL, OPENROUTER_DEFAULT_MODEL, *_FALLBACK_MODELS
//
// auto: Gemini → NVIDIA → Groq → OpenRouter (кто сконфигурирован).

import { AsyncLocalStorage } from "node:async_hooks";
import { GoogleGenAI } from "@google/genai";

export type ProviderPreference = "gemini" | "nvidia" | "groq" | "openrouter" | "auto";
export type LlmProviderId = "gemini" | "nvidia" | "groq" | "openrouter";

/** Ключи из UI (перекрывают/дополняют .env в рамках одного HTTP-запроса). */
export interface RequestLlmCredentials {
  geminiApiKeys?: string[];
  nvidiaApiKeys?: string[];
  groqApiKeys?: string[];
  openrouterApiKeys?: string[];
}

const providerOverrideAls = new AsyncLocalStorage<ProviderPreference>();
const credentialsAls = new AsyncLocalStorage<RequestLlmCredentials>();

export interface LlmGenerateParams {
  model?: string;
  systemInstruction?: string;
  contents: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  maxOutputTokens?: number;
}

export interface LlmGenerateResult {
  text: string;
  provider: LlmProviderId;
  model: string;
  finishReason?: string;
  /** Сколько раз сменили модель/провайдер до успеха (0 = с первого раза). */
  failoverCount?: number;
}

export interface LlmStatus {
  providerPreference: ProviderPreference;
  geminiKeys: number;
  nvidiaConfigured: boolean;
  groqConfigured: boolean;
  openrouterConfigured: boolean;
  nvidiaBaseUrl: string;
  nvidiaDefaultModel: string;
  groqDefaultModel: string;
  openrouterDefaultModel: string;
  nvidiaModelChain: string[];
  groqModelChain: string[];
  openrouterModelChain: string[];
  geminiModelChain: string[];
  activeGeminiKeyIndex: number;
  nvidiaRequestTimeoutMs: number;
  nvidiaCooledModels: string[];
  keysFromEnv: {
    gemini: boolean;
    nvidia: boolean;
    groq: boolean;
    openrouter: boolean;
  };
}

const DEFAULT_NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
// DeepSeek v4 flash — лучшая RU-проза по локальному бенчмарку NVIDIA.
const DEFAULT_NVIDIA_MODEL = "deepseek-ai/deepseek-v4-flash";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
// openrouter/auto часто платный (402 без credits); free-router — openrouter/free
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
const DEFAULT_NVIDIA_TIMEOUT_MS = 90_000;
const DEFAULT_NVIDIA_COOLDOWN_MS = 90_000;
/**
 * Groq free on_demand: TPM ~6000 на мелких моделях.
 * Requested ≈ prompt_tokens + max_tokens; держим max_tokens низко.
 */
const GROQ_MAX_OUTPUT_TOKENS = 1536;
const GROQ_MAX_SYSTEM_CHARS = 2800;
const GROQ_MAX_USER_CHARS = 5500;

const BUILTIN_GROQ_FALLBACKS = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

/**
 * Актуальные free-модели OpenRouter (live probe 2026-07).
 * :free список меняется — 404/402 → dead/cooldown, следующая.
 */
const BUILTIN_OPENROUTER_FALLBACKS = [
  "openrouter/free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "qwen/qwen3-coder:free",
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "tencent/hy3:free",
];

/**
 * Встроенная ротация NVIDIA для русской прозы (из live-каталога /v1/models).
 * Порядок: сильный RU/мультиязык → быстрые Mistral → Llama → лёгкий запас.
 * Не включаем модели, которые на probe отвечали по-английски (nemotron-3-*) или часто 404.
 */
const BUILTIN_NVIDIA_FALLBACKS = [
  // Tier A — лучшие для RU (DeepSeek / Qwen / GLM / MiniMax)
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "qwen/qwen3.5-122b-a10b",
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3.5-397b-a17b",
  "z-ai/glm-5.2",
  "minimaxai/minimax-m3",
  "minimaxai/minimax-m2.7",
  // Tier B — быстрые, стабильно отдают русский (Mistral family)
  "mistralai/mistral-medium-3.5-128b",
  "mistralai/mistral-small-4-119b-2603",
  "mistralai/mistral-nemotron",
  "mistralai/ministral-14b-instruct-2512",
  "mistralai/mistral-large-3-675b-instruct-2512",
  "mistralai/mistral-large-2-instruct",
  // Tier C — Llama / Nemotron-super (RU ок, больше AI-tell)
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "meta/llama-3.1-70b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "google/gemma-4-31b-it",
  // Tier D — лёгкий аварийный запас
  "meta/llama-3.1-8b-instruct",
  "mistralai/mistral-7b-instruct-v0.3",
];

/** Временный cooldown: model → timestamp до которого не трогаем. */
const nvidiaModelCooldownUntil = new Map<string, number>();
/** Модели с 404/410 — не долбим до перезапуска процесса. */
const nvidiaModelDead = new Set<string>();

const BUILTIN_GEMINI_FALLBACKS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
];

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function keysFromEnvList(names: string[]): string[] {
  const raw = names.map((n) => process.env[n]).filter(Boolean).join(",");
  return uniquePreserve(raw.split(",").map((key) => key.trim()).filter(Boolean));
}

function mergeKeys(fromRequest: string[] | undefined, fromEnv: string[]): string[] {
  // UI-ключи первыми — пользователь явно задал в приложении.
  return uniquePreserve([...(fromRequest || []), ...fromEnv]);
}

export function collectGeminiKeys(): string[] {
  const fromEnv = keysFromEnvList(["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"]);
  return mergeKeys(credentialsAls.getStore()?.geminiApiKeys, fromEnv);
}

export function collectNvidiaKeys(): string[] {
  const fromEnv = keysFromEnvList(["NVIDIA_API_KEY", "NVIDIA_API_KEY_2"]);
  return mergeKeys(credentialsAls.getStore()?.nvidiaApiKeys, fromEnv);
}

export function collectGroqKeys(): string[] {
  const fromEnv = keysFromEnvList(["GROQ_API_KEY", "GROQ_API_KEY_2"]);
  return mergeKeys(credentialsAls.getStore()?.groqApiKeys, fromEnv);
}

export function collectOpenrouterKeys(): string[] {
  const fromEnv = keysFromEnvList(["OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2"]);
  return mergeKeys(credentialsAls.getStore()?.openrouterApiKeys, fromEnv);
}

/** Разобрать apiKeys из body UI (строка или { gemini, nvidia, groq, openrouter }). */
export function parseRequestCredentials(raw: unknown): RequestLlmCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const pick = (value: unknown): string[] => {
    if (typeof value === "string") {
      return value.split(/[,;\n]+/u).map((s) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value.map((v) => String(v || "").trim()).filter(Boolean);
    }
    return [];
  };
  const creds: RequestLlmCredentials = {
    geminiApiKeys: pick(obj.gemini ?? obj.GEMINI_API_KEY ?? obj.geminiApiKey),
    nvidiaApiKeys: pick(obj.nvidia ?? obj.NVIDIA_API_KEY ?? obj.nvidiaApiKey),
    groqApiKeys: pick(obj.groq ?? obj.GROQ_API_KEY ?? obj.groqApiKey),
    openrouterApiKeys: pick(obj.openrouter ?? obj.OPENROUTER_API_KEY ?? obj.openrouterApiKey),
  };
  const any =
    (creds.geminiApiKeys?.length || 0)
    + (creds.nvidiaApiKeys?.length || 0)
    + (creds.groqApiKeys?.length || 0)
    + (creds.openrouterApiKeys?.length || 0);
  return any > 0 ? creds : null;
}

export function nvidiaBaseUrl(): string {
  return env("NVIDIA_BASE_URL", DEFAULT_NVIDIA_BASE).replace(/\/$/, "");
}

export function nvidiaDefaultModel(): string {
  return env("NVIDIA_DEFAULT_MODEL", DEFAULT_NVIDIA_MODEL);
}

export function groqDefaultModel(): string {
  return env("GROQ_DEFAULT_MODEL", DEFAULT_GROQ_MODEL);
}

export function openrouterDefaultModel(): string {
  return env("OPENROUTER_DEFAULT_MODEL", DEFAULT_OPENROUTER_MODEL);
}

export function groqBaseUrl(): string {
  return env("GROQ_BASE_URL", DEFAULT_GROQ_BASE).replace(/\/$/, "");
}

export function openrouterBaseUrl(): string {
  return env("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE).replace(/\/$/, "");
}

export function nvidiaRequestTimeoutMs(): number {
  const raw = Number(env("NVIDIA_REQUEST_TIMEOUT_MS", String(DEFAULT_NVIDIA_TIMEOUT_MS)));
  if (!Number.isFinite(raw) || raw < 5_000) return DEFAULT_NVIDIA_TIMEOUT_MS;
  return Math.min(Math.floor(raw), 600_000);
}

export function nvidiaCooldownMs(): number {
  const raw = Number(env("NVIDIA_COOLDOWN_MS", String(DEFAULT_NVIDIA_COOLDOWN_MS)));
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_NVIDIA_COOLDOWN_MS;
  return Math.min(Math.floor(raw), 600_000);
}

/** Цепочка NVIDIA-моделей: requested → DEFAULT → FALLBACK_MODELS → встроенный список. */
export function nvidiaModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim().replace(/^nvidia:/i, "");
  const fromEnv = splitList(env("NVIDIA_FALLBACK_MODELS"));
  const chain = [
    primary && !primary.toLowerCase().startsWith("gemini") && !primary.toLowerCase().startsWith("groq:")
      ? primary
      : "",
    nvidiaDefaultModel(),
    ...fromEnv,
    ...BUILTIN_NVIDIA_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function groqModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim().replace(/^groq:/i, "");
  const fromEnv = splitList(env("GROQ_FALLBACK_MODELS"));
  const chain = [
    primary && !primary.toLowerCase().startsWith("gemini") ? primary : "",
    groqDefaultModel(),
    ...fromEnv,
    ...BUILTIN_GROQ_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function openrouterModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim().replace(/^openrouter:/i, "");
  const fromEnv = splitList(env("OPENROUTER_FALLBACK_MODELS"));
  const chain = [
    primary && !primary.toLowerCase().startsWith("gemini") ? primary : "",
    openrouterDefaultModel(),
    ...fromEnv,
    ...BUILTIN_OPENROUTER_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function markNvidiaModelCooldown(model: string, reason: string, ms?: number): void {
  const until = Date.now() + (ms ?? nvidiaCooldownMs());
  nvidiaModelCooldownUntil.set(model, until);
  console.warn(
    `NVIDIA cooldown «${model}» ${Math.round((until - Date.now()) / 1000)}s (${reason})`,
  );
}

export function markNvidiaModelDead(model: string, reason: string): void {
  nvidiaModelDead.add(model);
  nvidiaModelCooldownUntil.delete(model);
  console.warn(`NVIDIA dead «${model}» — skip until restart (${reason})`);
}

export function isNvidiaModelOnCooldown(model: string): boolean {
  if (nvidiaModelDead.has(model)) return true;
  const until = nvidiaModelCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    nvidiaModelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

export function cooledNvidiaModels(): string[] {
  const now = Date.now();
  const out: string[] = [];
  for (const model of nvidiaModelDead) out.push(`${model} (dead)`);
  for (const [model, until] of nvidiaModelCooldownUntil) {
    if (until > now) out.push(`${model} (${Math.round((until - now) / 1000)}s)`);
  }
  return out;
}

/** Цепочка Gemini-моделей. */
export function geminiModelChain(preferred?: string): string[] {
  const primary = (preferred || "").trim();
  const fromEnv = splitList(env("GEMINI_FALLBACK_MODELS"));
  const chain = [
    primary && primary.toLowerCase().startsWith("gemini") ? primary : "",
    DEFAULT_GEMINI_MODEL,
    ...fromEnv,
    ...BUILTIN_GEMINI_FALLBACKS,
  ].filter(Boolean);
  return uniquePreserve(chain);
}

export function normalizeProviderPreference(value: unknown): ProviderPreference | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "gemini"
    || normalized === "nvidia"
    || normalized === "groq"
    || normalized === "openrouter"
    || normalized === "auto"
  ) {
    return normalized;
  }
  if (normalized === "both" || normalized === "any" || normalized === "all") return "auto";
  if (normalized === "google" || normalized === "gem") return "gemini";
  if (normalized === "nim" || normalized === "nv") return "nvidia";
  if (normalized === "or" || normalized === "open-router") return "openrouter";
  return null;
}

/** LLM_PROVIDER из env; при запросе из UI — override. */
export function providerPreference(): ProviderPreference {
  const fromRequest = providerOverrideAls.getStore();
  if (fromRequest) return fromRequest;
  const value = env("LLM_PROVIDER", "auto").toLowerCase();
  if (value === "gemini" || value === "nvidia" || value === "groq" || value === "openrouter") {
    return value;
  }
  return "auto";
}

/** @deprecated используйте runWithLlmRequestContext */
export function runWithProviderPreference<T>(
  preference: ProviderPreference | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithLlmRequestContext({ preference }, fn);
}

/** Провайдер + UI-ключи на время HTTP-запроса. */
export function runWithLlmRequestContext<T>(
  options: {
    preference?: ProviderPreference | null;
    credentials?: RequestLlmCredentials | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const runPref = () => {
    if (!options.preference) return fn();
    return providerOverrideAls.run(options.preference, fn);
  };
  if (!options.credentials) return runPref();
  return credentialsAls.run(options.credentials, runPref);
}

export function defaultModelForProvider(preference?: ProviderPreference): string {
  const pref = preference || providerPreference();
  if (pref === "nvidia") return nvidiaDefaultModel();
  if (pref === "groq") return groqDefaultModel();
  if (pref === "openrouter") return openrouterDefaultModel();
  if (pref === "gemini") return DEFAULT_GEMINI_MODEL;
  if (collectGeminiKeys().length > 0) return DEFAULT_GEMINI_MODEL;
  if (collectNvidiaKeys().length > 0) return nvidiaDefaultModel();
  if (collectGroqKeys().length > 0) return groqDefaultModel();
  if (collectOpenrouterKeys().length > 0) return openrouterDefaultModel();
  return DEFAULT_GEMINI_MODEL;
}

export function resolveSelectedModel(
  requested: string | undefined,
  preference?: ProviderPreference,
): string {
  const pref = preference || providerPreference();
  const raw = (requested || "").trim();

  if (pref === "nvidia") {
    if (!raw || raw.toLowerCase().startsWith("gemini") || raw.toLowerCase().startsWith("groq:")) {
      return nvidiaDefaultModel();
    }
    return raw.replace(/^nvidia:/i, "");
  }
  if (pref === "groq") {
    if (!raw || raw.toLowerCase().startsWith("gemini") || raw.includes("/")) {
      // openrouter/nvidia style — не для groq
      if (raw && !raw.includes("/") && !raw.toLowerCase().startsWith("gemini")) {
        return raw.replace(/^groq:/i, "");
      }
      return groqDefaultModel();
    }
    return raw.replace(/^groq:/i, "");
  }
  if (pref === "openrouter") {
    if (!raw || raw.toLowerCase().startsWith("gemini")) return openrouterDefaultModel();
    return raw.replace(/^openrouter:/i, "");
  }
  if (pref === "gemini") {
    if (!raw || isNvidiaModelName(raw) || isGroqModelName(raw) || isOpenRouterModelName(raw)) {
      return DEFAULT_GEMINI_MODEL;
    }
    return raw;
  }
  if (!raw) return defaultModelForProvider("auto");
  if (isOpenRouterModelName(raw)) return raw.replace(/^openrouter:/i, "");
  if (isGroqModelName(raw)) return raw.replace(/^groq:/i, "");
  if (isNvidiaModelName(raw)) return raw.replace(/^nvidia:/i, "");
  return raw;
}

export function getLlmStatus(): LlmStatus {
  return {
    providerPreference: providerPreference(),
    geminiKeys: collectGeminiKeys().length,
    nvidiaConfigured: collectNvidiaKeys().length > 0,
    groqConfigured: collectGroqKeys().length > 0,
    openrouterConfigured: collectOpenrouterKeys().length > 0,
    nvidiaBaseUrl: nvidiaBaseUrl(),
    nvidiaDefaultModel: nvidiaDefaultModel(),
    groqDefaultModel: groqDefaultModel(),
    openrouterDefaultModel: openrouterDefaultModel(),
    nvidiaModelChain: nvidiaModelChain(),
    groqModelChain: groqModelChain(),
    openrouterModelChain: openrouterModelChain(),
    geminiModelChain: geminiModelChain(),
    activeGeminiKeyIndex: activeGeminiKeyIndex,
    nvidiaRequestTimeoutMs: nvidiaRequestTimeoutMs(),
    nvidiaCooledModels: cooledNvidiaModels(),
    keysFromEnv: {
      gemini: keysFromEnvList(["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"]).length > 0,
      nvidia: keysFromEnvList(["NVIDIA_API_KEY", "NVIDIA_API_KEY_2"]).length > 0,
      groq: keysFromEnvList(["GROQ_API_KEY", "GROQ_API_KEY_2"]).length > 0,
      openrouter: keysFromEnvList(["OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2"]).length > 0,
    },
  };
}

// --- Gemini client (rotation) ---

let geminiClient: GoogleGenAI | null = null;
let activeGeminiKeyIndex = 0;

export function getGeminiClient(): GoogleGenAI {
  const keys = collectGeminiKeys();
  if (!keys.length) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  const apiKey = keys[Math.min(activeGeminiKeyIndex, keys.length - 1)];
  // UI-ключи на запрос — не кэшируем клиент между разными ключами.
  if (credentialsAls.getStore()) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "writers-studio" } },
    });
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "writers-studio" } },
    });
  }
  return geminiClient;
}

export function rotateGeminiKey(): GoogleGenAI | null {
  const keys = collectGeminiKeys();
  if (activeGeminiKeyIndex + 1 >= keys.length) return null;
  activeGeminiKeyIndex += 1;
  geminiClient = null;
  console.warn(
    `Ключ Gemini №${activeGeminiKeyIndex} исчерпал квоту — переключаюсь на резервный №${activeGeminiKeyIndex + 1} из ${keys.length}.`,
  );
  return getGeminiClient();
}

export function isDailyQuotaExhausted(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? "");
  return (
    message.includes("PerDay")
    || message.includes("generate_content_free_tier_requests")
    || message.includes("GenerateRequestsPerDay")
    || message.includes("RESOURCE_EXHAUSTED")
  );
}

export function isGroqModelName(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("groq:")) return true;
  // Groq id без слэша: llama-3.3-70b-versatile, gemma2-9b-it, mixtral-...
  if (m.startsWith("gemini") || m.includes("/")) return false;
  return /^(llama-|gemma|mixtral|whisper|qwen|deepseek)/i.test(m);
}

export function isOpenRouterModelName(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("openrouter:") || m.startsWith("openrouter/")) return true;
  if (m.includes(":free") || m.includes(":nitro") || m.includes(":floor")) return true;
  // org/model типичный для OpenRouter, но пересекается с NVIDIA — эвристика слабая
  if (/^(meta-llama|google\/gemma|qwen\/|mistralai\/|deepseek\/|microsoft\/|anthropic\/|openai\/)/i.test(m)) {
    return true;
  }
  return false;
}

export function isNvidiaModelName(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("nvidia:")) return true;
  if (m.startsWith("gemini") || m.startsWith("groq:")) return false;
  if (isOpenRouterModelName(model) || isGroqModelName(model)) return false;
  if (m.includes("/")) return true;
  return false;
}

export function normalizeModelName(model: string | undefined, provider: LlmProviderId): string {
  const raw = (model || "").trim();
  if (provider === "nvidia") {
    if (!raw || raw.startsWith("gemini")) return nvidiaDefaultModel();
    return raw.replace(/^nvidia:/i, "");
  }
  if (provider === "groq") {
    if (!raw || raw.startsWith("gemini") || raw.includes("/")) return groqDefaultModel();
    return raw.replace(/^groq:/i, "");
  }
  if (provider === "openrouter") {
    if (!raw || raw.startsWith("gemini")) return openrouterDefaultModel();
    return raw.replace(/^openrouter:/i, "");
  }
  if (!raw || isNvidiaModelName(raw) || isGroqModelName(raw) || isOpenRouterModelName(raw)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return raw;
}

function assertHasKeys(provider: LlmProviderId): void {
  if (provider === "gemini" && !collectGeminiKeys().length) {
    throw new Error("Gemini: нет ключа. Вставьте в Настройки ИИ или GEMINI_API_KEY в .env");
  }
  if (provider === "nvidia" && !collectNvidiaKeys().length) {
    throw new Error("NVIDIA: нет ключа. Вставьте в Настройки ИИ или NVIDIA_API_KEY в .env");
  }
  if (provider === "groq" && !collectGroqKeys().length) {
    throw new Error("Groq: нет ключа. Вставьте в Настройки ИИ (console.groq.com) или GROQ_API_KEY в .env");
  }
  if (provider === "openrouter" && !collectOpenrouterKeys().length) {
    throw new Error("OpenRouter: нет ключа. Вставьте в Настройки ИИ (openrouter.ai) или OPENROUTER_API_KEY в .env");
  }
}

export function resolveProvider(model?: string): LlmProviderId {
  const pref = providerPreference();
  const hasGemini = collectGeminiKeys().length > 0;
  const hasNvidia = collectNvidiaKeys().length > 0;
  const hasGroq = collectGroqKeys().length > 0;
  const hasOr = collectOpenrouterKeys().length > 0;
  const explicit = model?.trim() || "";

  if (pref === "gemini" || pref === "nvidia" || pref === "groq" || pref === "openrouter") {
    assertHasKeys(pref);
    return pref;
  }

  // auto: эвристика по имени модели
  if (explicit) {
    if (explicit.toLowerCase().startsWith("gemini")) {
      assertHasKeys("gemini");
      return "gemini";
    }
    if (isGroqModelName(explicit) && hasGroq) return "groq";
    if (isOpenRouterModelName(explicit) && hasOr) return "openrouter";
    if (isNvidiaModelName(explicit) && hasNvidia) return "nvidia";
  }

  if (hasGemini) return "gemini";
  if (hasNvidia) return "nvidia";
  if (hasGroq) return "groq";
  if (hasOr) return "openrouter";
  throw new Error(
    "Не задан ни один API-ключ. Откройте «Настройки ИИ» в шапке или пропишите ключи в .env "
    + "(GEMINI / NVIDIA / GROQ / OPENROUTER).",
  );
}

/** Ошибки, при которых имеет смысл сменить модель NVIDIA. */
export function isNvidiaModelFailoverError(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  const message = String((error as any)?.message ?? error ?? "");
  if (status === 401 || status === 403) return false; // ключ неверный — модели не помогут
  if ([429, 500, 502, 503, 504, 408, 404, 410, 402, 413, 400].includes(Number(status))) return true;
  return /unavailable|not found|does not exist|capacity|rate.?limit|overloaded|timeout|timed out|abort|RESOURCE_EXHAUSTED|no healthy|model.*(disabled|retired|invalid|decommissioned)|quota|Gone|Insufficient credits|no endpoints|Request too large|too large for model/i.test(message);
}

function schemaHint(schema: unknown): string {
  if (!schema) return "";
  try {
    const json = JSON.stringify(schema, (_key, value) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) {
        return value;
      }
      if (Array.isArray(value)) return value;
      if (typeof value === "object") return value;
      return String(value);
    });
    if (json && json !== "{}") {
      return `\n\nВерни ТОЛЬКО валидный JSON (без markdown-оградки). Ориентир по структуре:\n${json.slice(0, 6000)}`;
    }
  } catch {
    // ignore
  }
  return "\n\nВерни ТОЛЬКО валидный JSON без markdown-оградки и без пояснений.";
}

async function callNvidiaOnce(
  model: string,
  key: string,
  params: LlmGenerateParams,
  withJsonFormat: boolean,
): Promise<LlmGenerateResult> {
  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let userContent = params.contents;
  if (wantsJson) userContent += schemaHint(params.responseSchema);

  // Длинная генерация — больше таймаут; короткий JSON/план — быстрее failover.
  const baseTimeout = nvidiaRequestTimeoutMs();
  const maxTok = params.maxOutputTokens ?? 8192;
  const timeoutMs = wantsJson
    ? Math.min(baseTimeout, 45_000)
    : Math.min(Math.max(baseTimeout, 60_000), 60_000 + Math.floor(maxTok / 8));

  const body: Record<string, unknown> = {
    model,
    messages: [
      ...(params.systemInstruction
        ? [{ role: "system", content: params.systemInstruction }]
        : []),
      { role: "user", content: userContent },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: maxTok,
    stream: false,
  };
  if (wantsJson && withJsonFormat) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${nvidiaBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    if (error?.name === "AbortError" || /aborted|timeout/i.test(String(error?.message || ""))) {
      const err = new Error(`NVIDIA API timeout after ${timeoutMs}ms (${model})`);
      (err as any).status = 408;
      (err as any).body = "timeout";
      throw err;
    }
    const err = new Error(`NVIDIA network: ${String(error?.message || error).slice(0, 200)}`);
    (err as any).status = 503;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    const err = new Error(`NVIDIA API ${response.status}: ${raw.slice(0, 500)}`);
    (err as any).status = response.status;
    (err as any).body = raw;
    throw err;
  }

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>;
  };
  const content = data.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part === "string" ? part : part.text || "")).join("");
  }
  text = text.trim();
  if (!text) throw new Error("NVIDIA API: пустой ответ");
  text = text.replace(/^```(?:json|JSON)?\s*/u, "").replace(/\s*```$/u, "").trim();
  return {
    text,
    provider: "nvidia",
    model,
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

/**
 * NVIDIA: перебор моделей (DeepSeek → Qwen → Mistral → Llama…) и ключей.
 * 404/410 — модель «мёртвая» до рестарта; 503/timeout — cooldown, чтобы не ждать по кругу.
 */
async function generateViaNvidia(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  const keys = collectNvidiaKeys();
  if (!keys.length) throw new Error("NVIDIA_API_KEY is not configured.");

  const models = nvidiaModelChain(params.model);
  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let lastError: any = null;
  let attempts = 0;
  let skippedCooldown = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    if (isNvidiaModelOnCooldown(model)) {
      skippedCooldown += 1;
      continue;
    }

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const jsonModes = wantsJson ? [true, false] : [false];
      for (const withJson of jsonModes) {
        attempts += 1;
        try {
          const result = await callNvidiaOnce(model, keys[keyIndex], params, withJson);
          if (modelIndex > 0 || keyIndex > 0 || skippedCooldown > 0) {
            console.warn(`NVIDIA: успех на модели «${model}» (попытка #${attempts}, failover с предыдущих).`);
          }
          return { ...result, failoverCount: Math.max(0, modelIndex + keyIndex + skippedCooldown) };
        } catch (error: any) {
          lastError = error;
          const status = error?.status ?? error?.statusCode;
          const body = String(error?.body || error?.message || "");

          // json_object не поддержан — пробуем без него на той же модели
          if (withJson && (status === 400 || /response_format|json_object/i.test(body))) {
            continue;
          }

          // Неверный ключ — пробуем следующий ключ, не жжём все модели
          if (status === 401 || status === 403) {
            console.warn(`NVIDIA key #${keyIndex + 1} отклонён (${status}), следующий ключ…`);
            break;
          }

          // Модель недоступна / квота / 5xx / timeout → cooldown + следующая
          if (isNvidiaModelFailoverError(error)) {
            console.warn(
              `NVIDIA модель «${model}» недоступна (${status ?? "err"}): ${String(error?.message || "").slice(0, 120)} → следующая…`,
            );
            if (status === 404 || status === 410 || /not found|does not exist|invalid model|Gone/i.test(body)) {
              markNvidiaModelDead(model, String(status || "not-found"));
              break;
            }
            if (status === 429 && keyIndex + 1 < keys.length) {
              console.warn(`NVIDIA key #${keyIndex + 1} rate-limited, next key…`);
              break;
            }
            // 503 capacity / timeout / 5xx — не долбим эту модель на каждом следующем куске главы
            if (status === 503 || status === 429 || status === 408 || status === 502 || status === 504
              || /ResourceExhausted|capacity|timeout|overloaded/i.test(body + String(error?.message || ""))) {
              markNvidiaModelCooldown(model, String(status || "busy"));
            }
            break; // next model
          }

          // Неизвестная ошибка — cooldown короткий + следующая
          console.warn(`NVIDIA «${model}» ошибка, пробуем дальше:`, String(error?.message || error).slice(0, 160));
          markNvidiaModelCooldown(model, "error", Math.min(30_000, nvidiaCooldownMs()));
          break;
        }
      }
    }
  }

  const err = lastError || new Error(
    skippedCooldown > 0 && attempts === 0
      ? "NVIDIA API: все модели в cooldown/dead — подождите или смените NVIDIA_DEFAULT_MODEL"
      : "NVIDIA API: все модели и ключи недоступны",
  );
  (err as any).nvidiaChainTried = models;
  throw err;
}

/** OpenAI-compatible: Groq / OpenRouter (и при желании другие). */
async function callOpenAiCompatOnce(
  provider: "groq" | "openrouter",
  baseUrl: string,
  model: string,
  key: string,
  params: LlmGenerateParams,
  withJsonFormat: boolean,
  extraHeaders?: Record<string, string>,
): Promise<LlmGenerateResult> {
  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let userContent = params.contents;
  if (wantsJson) userContent += schemaHint(params.responseSchema);

  const baseTimeout = nvidiaRequestTimeoutMs();
  let maxTok = params.maxOutputTokens ?? 8192;
  if (provider === "groq") {
    maxTok = Math.min(maxTok, GROQ_MAX_OUTPUT_TOKENS);
  }
  // Groq free TPM: prompt + max_tokens ≤ ~6000
  let systemContent = params.systemInstruction || "";
  if (provider === "groq") {
    if (systemContent.length > GROQ_MAX_SYSTEM_CHARS) {
      systemContent = systemContent.slice(0, GROQ_MAX_SYSTEM_CHARS) + "\n…";
    }
    if (userContent.length > GROQ_MAX_USER_CHARS) {
      userContent = userContent.slice(0, GROQ_MAX_USER_CHARS)
        + "\n…\n[укорочено под лимит Groq free TPM; пиши полную сцену на русском ≥350 слов]";
    }
  }
  const timeoutMs = wantsJson
    ? Math.min(baseTimeout, 45_000)
    : Math.min(Math.max(baseTimeout, 60_000), 60_000 + Math.floor(maxTok / 8));

  const body: Record<string, unknown> = {
    model,
    messages: [
      ...(systemContent
        ? [{ role: "system", content: systemContent }]
        : []),
      { role: "user", content: userContent },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: maxTok,
    stream: false,
  };
  if (wantsJson && withJsonFormat) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    if (error?.name === "AbortError" || /aborted|timeout/i.test(String(error?.message || ""))) {
      const err = new Error(`${provider} timeout after ${timeoutMs}ms (${model})`);
      (err as any).status = 408;
      throw err;
    }
    const err = new Error(`${provider} network: ${String(error?.message || error).slice(0, 200)}`);
    (err as any).status = 503;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    const err = new Error(`${provider} API ${response.status}: ${raw.slice(0, 500)}`);
    (err as any).status = response.status;
    (err as any).body = raw;
    throw err;
  }

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>;
  };
  const content = data.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part === "string" ? part : part.text || "")).join("");
  }
  text = text.trim();
  if (!text) throw new Error(`${provider} API: пустой ответ`);
  text = text.replace(/^```(?:json|JSON)?\s*/u, "").replace(/\s*```$/u, "").trim();
  return {
    text,
    provider,
    model,
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

async function generateViaOpenAiChain(
  provider: "groq" | "openrouter",
  params: LlmGenerateParams,
): Promise<LlmGenerateResult> {
  const keys = provider === "groq" ? collectGroqKeys() : collectOpenrouterKeys();
  if (!keys.length) {
    throw new Error(
      provider === "groq"
        ? "GROQ_API_KEY is not configured."
        : "OPENROUTER_API_KEY is not configured.",
    );
  }

  const models = provider === "groq" ? groqModelChain(params.model) : openrouterModelChain(params.model);
  const baseUrl = provider === "groq" ? groqBaseUrl() : openrouterBaseUrl();
  const extraHeaders = provider === "openrouter"
    ? {
      "HTTP-Referer": env("APP_URL", "http://localhost:3000"),
      "X-Title": "Writer's Studio",
    }
    : undefined;

  const wantsJson = params.responseMimeType === "application/json" || Boolean(params.responseSchema);
  let lastError: any = null;
  let attempts = 0;
  // Один «круг» + при полном TPM 413 на free Groq — пауза и второй круг
  const rounds = provider === "groq" ? 2 : 1;

  for (let round = 0; round < rounds; round += 1) {
    if (round > 0) {
      console.warn(`${provider}: TPM/лимиты — пауза 55с перед повтором цепочки…`);
      await new Promise((r) => setTimeout(r, 55_000));
    }

    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];
      if (isNvidiaModelOnCooldown(`${provider}:${model}`)) continue;

      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const jsonModes = wantsJson ? [true, false] : [false];
        for (const withJson of jsonModes) {
          attempts += 1;
          try {
            const result = await callOpenAiCompatOnce(
              provider,
              baseUrl,
              model,
              keys[keyIndex],
              params,
              withJson,
              extraHeaders,
            );
            if (modelIndex > 0 || keyIndex > 0 || round > 0) {
              console.warn(`${provider}: успех на «${model}» (попытка #${attempts}).`);
            }
            // free Groq: маленькая пауза, чтобы не упираться в TPM на следующем куске
            if (provider === "groq") {
              await new Promise((r) => setTimeout(r, 1200));
            }
            return { ...result, failoverCount: Math.max(0, modelIndex + keyIndex + round) };
          } catch (error: any) {
            lastError = error;
            const status = error?.status ?? error?.statusCode;
            const body = String(error?.body || error?.message || "");

            if (withJson && (status === 400 || /response_format|json_object/i.test(body))) continue;
            if (status === 401 || status === 403) {
              console.warn(`${provider} key #${keyIndex + 1} отклонён (${status})`);
              break;
            }
            if (isNvidiaModelFailoverError(error)) {
              console.warn(
                `${provider} «${model}» недоступна (${status ?? "err"}): ${String(error?.message || "").slice(0, 100)} → следующая…`,
              );
              if (
                status === 404 || status === 410
                || /not found|does not exist|no endpoints|decommissioned/i.test(body)
              ) {
                markNvidiaModelDead(`${provider}:${model}`, String(status || "not-found"));
              } else if (status === 402 || /Insufficient credits/i.test(body)) {
                markNvidiaModelDead(`${provider}:${model}`, "402-credits");
              } else if (status === 413 || /Request too large|too large for model|tokens per minute|TPM/i.test(body)) {
                // TPM: короткая пауза, не «убиваем» модель надолго
                markNvidiaModelCooldown(`${provider}:${model}`, "413-tpm", 20_000);
              } else if (status === 503 || status === 429 || status === 408 || status === 502 || status === 504) {
                markNvidiaModelCooldown(`${provider}:${model}`, String(status || "busy"), 45_000);
              }
              break;
            }
            console.warn(`${provider} «${model}» ошибка:`, String(error?.message || error).slice(0, 120));
            markNvidiaModelCooldown(`${provider}:${model}`, "error", 30_000);
            break;
          }
        }
      }
    }
  }

  throw lastError || new Error(`${provider}: все модели недоступны`);
}

async function generateViaGroq(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  return generateViaOpenAiChain("groq", params);
}

async function generateViaOpenrouter(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  return generateViaOpenAiChain("openrouter", params);
}

async function callGeminiOnce(
  client: GoogleGenAI,
  modelName: string,
  params: LlmGenerateParams,
): Promise<LlmGenerateResult> {
  const response = await client.models.generateContent({
    model: modelName,
    contents: params.contents,
    config: {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? 0.7,
      responseMimeType: params.responseMimeType,
      responseSchema: params.responseSchema as any,
      maxOutputTokens: params.maxOutputTokens,
      ...(modelName.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const finishReason = String((response as any)?.candidates?.[0]?.finishReason || "");
  if (/MAX_TOKENS|LENGTH/i.test(finishReason)) {
    throw new Error("Ответ модели был обрезан по лимиту токенов");
  }
  const text = response.text?.trim();
  if (!text) throw new Error("Модель вернула пустой ответ");
  return { text, provider: "gemini", model: modelName, finishReason };
}

async function generateViaGemini(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  if (!collectGeminiKeys().length) throw new Error("GEMINI_API_KEY is not configured.");

  const models = geminiModelChain(params.model);
  let lastError: any = null;
  let ai = getGeminiClient();

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const result = await callGeminiOnce(ai, model, params);
        if (modelIndex > 0) {
          console.warn(`Gemini: успех на «${model}» после failover.`);
        }
        return { ...result, failoverCount: modelIndex };
      } catch (error: any) {
        lastError = error;
        const status = error?.status ?? error?.statusCode;

        if (status === 429 && isDailyQuotaExhausted(error)) {
          const rotated = rotateGeminiKey();
          if (rotated) {
            ai = rotated;
            continue;
          }
          // дневная квота на всех ключах для этой модели → следующая модель
          console.warn(`Gemini «${model}»: дневная квота, следующая модель…`);
          break;
        }

        const message = String(error?.message ?? "");
        const causeCode = error?.cause?.code ?? error?.code;
        const isNetworkError = status == null && (
          causeCode === "ECONNRESET" || causeCode === "ETIMEDOUT" || causeCode === "ECONNREFUSED"
          || message.includes("terminated") || message.includes("fetch failed")
        );
        const isRetryable = status === 503 || status === 429 || status === 500 || isNetworkError;
        if (isRetryable && attempt < maxRetries) {
          const delayMs = Math.min(1000 * 2 ** attempt, 6000) + Math.random() * 400;
          console.warn(`Gemini «${model}» attempt ${attempt + 1} failed (${status}). Retry ${Math.round(delayMs)}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // модель недоступна → следующая в цепочке
        if (status === 404 || status === 400 || status === 503 || status === 429 || isDailyQuotaExhausted(error)) {
          console.warn(`Gemini «${model}» недоступна (${status ?? "err"}) → следующая…`);
          break;
        }
        // прочие ошибки — тоже пробуем следующую модель
        console.warn(`Gemini «${model}» ошибка → следующая:`, message.slice(0, 120));
        break;
      }
    }
  }

  throw lastError || new Error("Gemini: все модели недоступны");
}

/**
 * Главная точка входа.
 * auto: цепочка провайдеров Gemini → NVIDIA → Groq → OpenRouter.
 * Иначе только выбранный провайдер (свои модели внутри).
 */
export async function llmGenerate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
  const pref = providerPreference();
  const preferred = resolveProvider(params.model);

  const has: Record<LlmProviderId, boolean> = {
    gemini: collectGeminiKeys().length > 0,
    nvidia: collectNvidiaKeys().length > 0,
    groq: collectGroqKeys().length > 0,
    openrouter: collectOpenrouterKeys().length > 0,
  };

  const runOne = async (id: LlmProviderId, label?: string): Promise<LlmGenerateResult> => {
    if (label) console.warn(label);
    if (id === "gemini") {
      return generateViaGemini({
        ...params,
        model: (params.model || "").toLowerCase().startsWith("gemini")
          ? params.model
          : DEFAULT_GEMINI_MODEL,
      });
    }
    if (id === "nvidia") {
      return generateViaNvidia({
        ...params,
        model: isNvidiaModelName(params.model || "") ? params.model : nvidiaDefaultModel(),
      });
    }
    if (id === "groq") {
      return generateViaGroq({
        ...params,
        model: isGroqModelName(params.model || "") ? params.model : groqDefaultModel(),
      });
    }
    return generateViaOpenrouter({
      ...params,
      model: isOpenRouterModelName(params.model || "") ? params.model : openrouterDefaultModel(),
    });
  };

  // Жёсткий выбор провайдера — без кросс-failover
  if (pref !== "auto") {
    return runOne(preferred);
  }

  // auto: сначала preferred (по модели), затем остальные
  const order = uniquePreserve([
    preferred,
    "gemini",
    "nvidia",
    "groq",
    "openrouter",
  ]) as LlmProviderId[];

  let lastError: any = null;
  for (const id of order) {
    if (!has[id]) continue;
    try {
      if (id !== preferred) {
        return await runOne(id, `auto-failover → ${id}…`);
      }
      return await runOne(id);
    } catch (error: any) {
      lastError = error;
      console.warn(`Провайдер ${id} не сработал: ${String(error?.message || error).slice(0, 120)}`);
    }
  }

  throw lastError || new Error("Все LLM-провайдеры недоступны. Проверьте ключи в Настройках ИИ или .env");
}

/** Совместимость со старым ensureCompleteResponse-style callers. */
export function llmTextOrThrow(result: LlmGenerateResult, label: string): string {
  if (!result.text?.trim()) throw new Error(`${label}: модель вернула пустой ответ`);
  if (result.finishReason && /MAX_TOKENS|LENGTH|length/i.test(result.finishReason)) {
    throw new Error(`${label}: ответ модели был обрезан по лимиту токенов`);
  }
  return result.text;
}
