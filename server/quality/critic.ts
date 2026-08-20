import { parseJsonResponse } from "../authorPipeline";
import { buildCriticPrompt, criticSchema } from "./prompts";
import type {
  CriticAssessment,
  DimensionAssessment,
  QualityCandidate,
  QualityGateRequest,
  QualityGenerate,
  QualityRubric,
} from "./types";

interface RawCriticAssessment {
  totalScore: unknown;
  dimensions: Array<{
    dimensionId: unknown;
    score: unknown;
    finding: unknown;
    severity: unknown;
  }>;
  blockingIssues: unknown;
  summary: unknown;
}

function boundedNumber(value: unknown, maximum: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(maximum, Math.round(number * 10) / 10));
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeCriticAssessment(
  candidateId: string,
  rubric: QualityRubric,
  raw: RawCriticAssessment,
): CriticAssessment {
  const dimensions: DimensionAssessment[] = rubric.dimensions.map((dimension) => {
    const match = Array.isArray(raw.dimensions)
      ? raw.dimensions.find((item) => item?.dimensionId === dimension.id)
      : undefined;
    const severity = match?.severity === "blocking" || match?.severity === "warning" ? match.severity : "none";
    return {
      dimensionId: dimension.id,
      score: boundedNumber(match?.score, dimension.weight),
      finding: boundedText(match?.finding, 500) || "Оценка по измерению не получена.",
      severity,
    };
  });
  const blockingIssues = [
    ...dimensions.filter((dimension) => dimension.severity === "blocking").map((dimension) => dimension.finding),
    ...(Array.isArray(raw.blockingIssues)
      ? raw.blockingIssues.filter((issue): issue is string => typeof issue === "string" && Boolean(issue.trim())).map((issue) => issue.trim().slice(0, 500))
      : []),
  ];

  return {
    candidateId,
    totalScore: Math.round(dimensions.reduce((total, dimension) => total + dimension.score, 0) * 10) / 10,
    dimensions,
    blockingIssues: [...new Set(blockingIssues)],
    summary: boundedText(raw.summary, 500) || "Критик не вернул краткого объяснения.",
  };
}

export async function evaluateCandidateQuality(
  request: QualityGateRequest,
  candidate: QualityCandidate,
  rubric: QualityRubric,
  generate: QualityGenerate,
): Promise<CriticAssessment> {
  const rawText = await generate({
    model: request.criticModel,
    systemInstruction: "Ты независимый литературный критик. Оцениваешь версии строго по входной рубрике и возвращаешь только JSON.",
    contents: buildCriticPrompt(request, candidate, rubric),
    temperature: 0.1,
    responseMimeType: "application/json",
    responseSchema: criticSchema,
    maxOutputTokens: 4096,
  });
  const raw = parseJsonResponse<RawCriticAssessment>(rawText, "Quality Gate critic");
  return normalizeCriticAssessment(candidate.id, rubric, raw);
}
