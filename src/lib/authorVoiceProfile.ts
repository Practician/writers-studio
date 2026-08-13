import type { AuthorProfileRecord } from "../types";
import { hashText } from "./authorAudit";
import { loadDeepProfile, saveDeepProfile } from "./authorStorage";

export interface DeepStyleProfileSnapshot {
  voiceSheet: AuthorProfileRecord["voiceSheet"];
  metrics: unknown;
  patterns: unknown;
  exemplars: unknown[];
  version: number;
  createdAt: string;
  updatedAt: string;
  sampleCharCount: number;
  /** Хеш исходного авторского корпуса; invalidates stale cached profile. */
  sourceHash?: string;
}

function isDeepStyleProfile(value: unknown): value is DeepStyleProfileSnapshot {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<DeepStyleProfileSnapshot>;
  return typeof profile.sampleCharCount === "number"
    && typeof profile.version === "number"
    && Array.isArray(profile.exemplars)
    && Boolean(profile.voiceSheet);
}

export function authorCorpusRevision(profile: Pick<AuthorProfileRecord, "sample" | "voiceSheet">): string {
  return hashText(`${profile.sample}\n${JSON.stringify(profile.voiceSheet ?? {})}`);
}

export function authorVoiceProfileReady(profile: AuthorProfileRecord | undefined): profile is AuthorProfileRecord {
  return Boolean(profile?.sample?.trim() && profile.sample.trim().length >= 300 && profile.voiceSheet);
}

/**
 * Возвращает профиль, привязанный к точному образцу. Кэшированная версия недействительна,
 * если автор заменил sample или паспорт голоса.
 */
export async function loadOrBuildDeepStyleProfile(
  profile: AuthorProfileRecord,
  model: string,
  llmProvider: string,
  llmApiFields: Record<string, unknown>,
): Promise<DeepStyleProfileSnapshot> {
  if (!authorVoiceProfileReady(profile)) {
    throw new Error("Для режима «Авторский голос» нужен паспорт и образец автора не короче 300 знаков.");
  }
  const sourceHash = authorCorpusRevision(profile);
  const cached = await loadDeepProfile(profile.storyId);
  if (isDeepStyleProfile(cached) && cached.sourceHash === sourceHash) return cached;

  const response = await fetch("/api/style/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...llmApiFields,
      sample: profile.sample,
      existingProfile: undefined,
      model,
      llmProvider,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Не удалось построить глубокий паспорт голоса");
  const deepProfile = { ...(payload as DeepStyleProfileSnapshot), sourceHash };
  await saveDeepProfile(profile.storyId, deepProfile);
  return deepProfile;
}
