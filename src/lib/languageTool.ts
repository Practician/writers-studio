export interface LanguageToolSettings {
  endpoint: string;
  language: string;
}

export interface LanguageToolMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements: string[];
  ruleId?: string;
  category?: string;
}

const SETTINGS_KEY = "writers_studio_languagetool_settings";

export function loadLanguageToolSettings(): LanguageToolSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { endpoint: "", language: "ru-RU" };
    const parsed = JSON.parse(raw) as Partial<LanguageToolSettings>;
    return { endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "", language: typeof parsed.language === "string" ? parsed.language : "ru-RU" };
  } catch {
    return { endpoint: "", language: "ru-RU" };
  }
}

export function saveLanguageToolSettings(settings: LanguageToolSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function normalizedEndpoint(value: string): string {
  return value.trim().replace(/\/$/u, "");
}

export async function checkWithLanguageTool(text: string, settings: LanguageToolSettings): Promise<LanguageToolMatch[]> {
  const endpoint = normalizedEndpoint(settings.endpoint);
  if (!endpoint) throw new Error("Укажите свой endpoint LanguageTool. Текст не отправлялся.");
  if (!/^https?:\/\//iu.test(endpoint)) throw new Error("Endpoint должен начинаться с http:// или https://");
  const body = new URLSearchParams({ text, language: settings.language || "ru-RU" });
  const response = await fetch(`${endpoint}/v2/check`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`LanguageTool вернул HTTP ${response.status}`);
  const payload = await response.json() as { matches?: Array<{ message?: string; shortMessage?: string; offset?: number; length?: number; replacements?: Array<{ value?: string }>; rule?: { id?: string; category?: { name?: string } } }> };
  return (payload.matches || []).map((match) => ({
    message: match.message || "Редакторское замечание",
    shortMessage: match.shortMessage,
    offset: Math.max(0, Number(match.offset) || 0),
    length: Math.max(0, Number(match.length) || 0),
    replacements: (match.replacements || []).flatMap((replacement) => typeof replacement.value === "string" ? [replacement.value] : []).slice(0, 5),
    ruleId: match.rule?.id,
    category: match.rule?.category?.name,
  }));
}
