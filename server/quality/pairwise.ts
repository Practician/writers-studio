import { parseJsonResponse } from "../authorPipeline";
import { buildPairwisePrompt, pairwiseSchema } from "./prompts";
import type { PairwiseVote, QualityGateRequest, QualityGenerate, QualityRubric } from "./types";

interface RawPairwiseVote {
  winner: unknown;
  confidence: unknown;
  reason: unknown;
}

function normalizeConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

function normalizeReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function mapWinner(value: unknown, candidateIsA: boolean): PairwiseVote["winner"] {
  if (value === "tie") return "TIE";
  if (value === "A") return candidateIsA ? "CANDIDATE" : "SOURCE";
  if (value === "B") return candidateIsA ? "SOURCE" : "CANDIDATE";
  return "TIE";
}

async function runVote(
  request: QualityGateRequest,
  rubric: QualityRubric,
  sourceText: string,
  candidateText: string,
  order: PairwiseVote["order"],
  generate: QualityGenerate,
): Promise<PairwiseVote> {
  const candidateIsA = order === "CANDIDATE_FIRST";
  const firstText = candidateIsA ? candidateText : sourceText;
  const secondText = candidateIsA ? sourceText : candidateText;
  const rawText = await generate({
    model: request.judgeModel,
    systemInstruction: "Ты строгий литературный судья. Сравниваешь версии в обоих порядках и возвращаешь только JSON.",
    contents: buildPairwisePrompt(request, rubric, firstText, secondText),
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: pairwiseSchema,
    maxOutputTokens: 2048,
  });
  const raw = parseJsonResponse<RawPairwiseVote>(rawText, "Quality Gate pairwise judge");
  return {
    order,
    winner: mapWinner(raw.winner, candidateIsA),
    confidence: normalizeConfidence(raw.confidence),
    reason: normalizeReason(raw.reason) || "Судья не вернул краткого объяснения.",
  };
}

export async function runOrderInvertedDuel(
  request: QualityGateRequest,
  rubric: QualityRubric,
  candidateText: string,
  generate: QualityGenerate,
): Promise<PairwiseVote[]> {
  const forward = await runVote(
    request,
    rubric,
    request.sourceText,
    candidateText,
    "SOURCE_FIRST",
    generate,
  );
  const reverse = await runVote(
    request,
    rubric,
    request.sourceText,
    candidateText,
    "CANDIDATE_FIRST",
    generate,
  );
  return [forward, reverse];
}
