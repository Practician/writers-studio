export const DEFAULT_MAX_AI_TELL_SCORE = 18;
export const MIN_MAX_AI_TELL_SCORE = 0;
export const MAX_MAX_AI_TELL_SCORE = 60;

export type AiTellRiskBand = "clear" | "watch" | "high";

export interface AiTellRiskAssessment {
  /** Шкала локальных AI-признаков: меньшее значение означает меньший риск. */
  riskScore: number;
  maxRiskScore: number;
  passed: boolean;
  band: AiTellRiskBand;
  label: string;
}

/**
 * Нормализует допустимый максимум локального AI-tell score.
 * Значение 0 является валидным строгим порогом, поэтому не используется `||`.
 */
export function normalizeMaxAiTellScore(
  value: unknown,
  fallback = DEFAULT_MAX_AI_TELL_SCORE,
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(MAX_MAX_AI_TELL_SCORE, Math.max(MIN_MAX_AI_TELL_SCORE, Math.round(candidate)));
}

/**
 * Единая трактовка локальной шкалы: 0 — меньше AI-признаков, большее число — выше риск.
 * Эта оценка не является вердиктом об авторстве и не должна самостоятельно менять текст.
 */
export function assessAiTellRisk(
  riskScore: number,
  maxRiskScore = DEFAULT_MAX_AI_TELL_SCORE,
): AiTellRiskAssessment {
  const normalizedScore = Math.max(0, Math.round(Number.isFinite(riskScore) ? riskScore : 100));
  const threshold = normalizeMaxAiTellScore(maxRiskScore);
  const passed = normalizedScore <= threshold;
  const ratio = threshold > 0 ? normalizedScore / threshold : normalizedScore > 0 ? Number.POSITIVE_INFINITY : 0;
  const band: AiTellRiskBand = passed
    ? "clear"
    : ratio <= 1.5
      ? "watch"
      : "high";
  const label = band === "clear"
    ? "Низкий риск генеративных паттернов"
    : band === "watch"
      ? "Есть признаки, требующие бережной доводки"
      : "Высокий риск генеративных паттернов";

  return {
    riskScore: normalizedScore,
    maxRiskScore: threshold,
    passed,
    band,
    label,
  };
}
