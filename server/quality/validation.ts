import { randomUUID } from "node:crypto";
import type { AuthorVoiceSheet } from "../../src/types";
import { DEFAULT_AUTHOR_MODEL, normalizeProtectedTerms } from "../authorPipeline";
import type {
  AuthorRewriteContext,
} from "../authorPipeline";
import type { CandidateOrigin, QualityGateHttpRequest, QualityGateRequest, RubricPreset } from "./types";

const MAX_TEXT_LENGTH = 120_000;
const MAX_MODEL_LENGTH = 200;

function asText(value: unknown, name: string, maximum: number, minimum = 0): string {
  if (typeof value !== "string") throw new Error(`${name}: ожидалась строка`);
  if (value.trim().length < minimum) throw new Error(`${name}: требуется не менее ${minimum} знаков`);
  if (value.length > maximum) throw new Error(`${name}: превышен лимит ${maximum} знаков`);
  return value;
}

function optionalText(value: unknown, name: string, maximum: number): string {
  if (value == null) return "";
  return asText(value, name, maximum);
}

function normalizedContext(value: unknown): AuthorRewriteContext {
  const context = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    title: optionalText(context.title, "context.title", 500),
    genre: optionalText(context.genre, "context.genre", 300),
    description: optionalText(context.description, "context.description", 10_000),
    chapterTitle: optionalText(context.chapterTitle, "context.chapterTitle", 500),
    chapterSummary: optionalText(context.chapterSummary, "context.chapterSummary", 10_000),
    worldBible: optionalText(context.worldBible, "context.worldBible", 120_000),
    bookPlan: optionalText(context.bookPlan, "context.bookPlan", 120_000),
    previousChapter: optionalText(context.previousChapter, "context.previousChapter", 20_000),
    nextChapterSummary: optionalText(context.nextChapterSummary, "context.nextChapterSummary", 10_000),
  };
}

function normalizedVoiceSheet(value: unknown): AuthorVoiceSheet {
  const sheet = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<AuthorVoiceSheet>
    : {};
  return {
    summary: typeof sheet.summary === "string" ? sheet.summary.slice(0, 5_000) : "",
    voiceRules: Array.isArray(sheet.voiceRules)
      ? sheet.voiceRules.filter((rule): rule is string => typeof rule === "string").slice(0, 30)
      : [],
    avoid: Array.isArray(sheet.avoid)
      ? sheet.avoid.filter((rule): rule is string => typeof rule === "string").slice(0, 30)
      : [],
    evidence: Array.isArray(sheet.evidence)
      ? sheet.evidence
        .filter((item): item is { quote: string; observation: string } => Boolean(
          item && typeof item === "object" && typeof (item as any).quote === "string" && typeof (item as any).observation === "string",
        ))
        .slice(0, 20)
        .map((item) => ({ quote: item.quote.slice(0, 1_000), observation: item.observation.slice(0, 1_000) }))
      : [],
  };
}

function normalizedOrigin(value: unknown): CandidateOrigin {
  return value === "touchup" || value === "manual" || value === "generation" ? value : "author_rewrite";
}

function normalizedPreset(value: unknown): RubricPreset {
  return value === "scene_revision" ? "scene_revision" : "author_edit";
}

function normalizedModel(value: unknown, name: string): string {
  return typeof value === "string" && value.trim()
    ? asText(value, name, MAX_MODEL_LENGTH, 1)
    : DEFAULT_AUTHOR_MODEL;
}

export function validateQualityGateRequest(value: unknown): QualityGateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Тело запроса Quality Gate должно быть объектом");
  }
  const body = value as QualityGateHttpRequest;
  const sourceText = asText(body.sourceText, "sourceText", MAX_TEXT_LENGTH, 20);
  if (!Array.isArray(body.candidates) || body.candidates.length < 1 || body.candidates.length > 3) {
    throw new Error("candidates: требуется от 1 до 3 кандидатов");
  }

  const candidateIds = new Set<string>();
  const candidates = body.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") throw new Error(`candidates[${index}]: ожидался объект`);
    const id = typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim().slice(0, 120)
      : `candidate-${index + 1}`;
    if (candidateIds.has(id)) throw new Error(`candidates: повторяющийся id ${id}`);
    candidateIds.add(id);
    return {
      id,
      text: asText(candidate.text, `candidates[${index}].text`, MAX_TEXT_LENGTH, 1),
      origin: normalizedOrigin(candidate.origin),
      diagnostics: candidate.diagnostics,
    };
  });

  const requestId = typeof body.requestId === "string" && body.requestId.trim()
    ? body.requestId.trim().slice(0, 120)
    : randomUUID();

  return {
    requestId,
    sourceText,
    candidates,
    protectedTerms: normalizeProtectedTerms(body.protectedTerms),
    context: normalizedContext(body.context),
    voiceSheet: normalizedVoiceSheet(body.voiceSheet),
    analysis: body.analysis ?? {},
    rubricPreset: normalizedPreset(body.rubricPreset),
    criticModel: normalizedModel(body.criticModel, "criticModel"),
    judgeModel: normalizedModel(body.judgeModel, "judgeModel"),
  };
}
