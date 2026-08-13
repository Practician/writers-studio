import { hashText } from "./authorAudit";
import type { AuthorRules } from "../types";
import {
  assessAiTellRisk,
  type AiTellRiskAssessment,
  type AiTellRiskBand,
} from "./coauthorQuality";

export type CoauthorMode = "quick" | "guided" | "autonomous";

export type CoauthorIntent =
  | "continue"
  | "rewrite"
  | "improve"
  | "brainstorm"
  | "plan"
  | "audit";

export interface TextRange {
  start: number;
  end: number;
}

export interface CoauthorTarget {
  storyId: string;
  chapterId?: string;
  /** Хеш исходного текста, на который рассчитаны изменения. */
  baseRevision: string;
  selection?: TextRange;
}

export interface CoauthorCodexHit {
  entryId: string;
  label: string;
  excerpt: string;
  reason: string;
  score: number;
}

export interface CoauthorRunInput {
  title?: string;
  genre?: string;
  description?: string;
  chapterTitle?: string;
  chapterSummary?: string;
  baseText: string;
  selectedText?: string;
  previousChapter?: string;
  worldBible?: string;
  bookPlan?: string;
  codexContext?: string;
  codexHits?: CoauthorCodexHit[];
  authorSample?: string;
  voiceSheet?: unknown;
  authorRules?: AuthorRules;
  /** Версионируемый глубокий профиль: метрики, паттерны и эталоны автора. */
  styleProfile?: unknown;
  customPrompt?: string;
}

export interface CoauthorRunRequest {
  mode: CoauthorMode;
  intent: CoauthorIntent;
  target: CoauthorTarget;
  goal: string;
  input: CoauthorRunInput;
  options: {
    humanizeDepth: "fast" | "balanced" | "maximum";
    model: string;
    /** В этом режиме паспорт и подтверждённый образец обязательны для запуска. */
    authorVoice?: {
      enabled: boolean;
      profileRevision: string;
    };
  };
}

export type ContextManifestItemSource =
  | "story"
  | "chapter"
  | "previous_chapter"
  | "world_bible"
  | "book_plan"
  | "author_voice"
  | "author_rule"
  | "codex"
  | "scene"
  | "semantic_retrieval";

export interface ContextManifestItem {
  id: string;
  sourceType: ContextManifestItemSource;
  sourceId?: string;
  revisionId?: string;
  label: string;
  reason: string;
  relevance: "required" | "supporting" | "optional";
  inclusionPolicy: "always" | "detected" | "manual" | "never";
  tokenEstimate: number;
  excerpt: string;
  status: "included" | "excluded";
}

export interface StoryContextSnapshot {
  storyId: string;
  chapterId?: string;
  baseRevision: string;
  capturedAt: string;
  input: CoauthorRunInput;
  /** Объяснимый список источников, собранных для конкретного запуска. */
  contextManifest: ContextManifestItem[];
}

export type CoauthorRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed";

export interface CoauthorPlanStep {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface CoauthorCheckpoint {
  id: string;
  createdAt: string;
  title: string;
  message: string;
  status: CoauthorRunStatus;
}

export interface CoauthorFeedback {
  decision: "accepted" | "rejected" | "edited";
  note?: string;
  createdAt: string;
}

export interface CoauthorRun {
  id: string;
  mode: CoauthorMode;
  intent: CoauthorIntent;
  goal: string;
  options: CoauthorRunRequest["options"];
  status: CoauthorRunStatus;
  context: StoryContextSnapshot;
  plan: CoauthorPlanStep[];
  checkpoints: CoauthorCheckpoint[];
  feedback?: CoauthorFeedback;
  changeset?: Changeset;
  quality?: QualityReport;
  /** Текстовый результат без неявного применения к рукописи. */
  output?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type ChangesetOperation =
  | {
      kind: "append";
      text: string;
      reason: string;
    }
  | {
      kind: "replace_selection";
      range: TextRange;
      expectedTextHash: string;
      text: string;
      reason: string;
    };

export interface Changeset {
  id: string;
  baseRevision: string;
  createdAt: string;
  summary: string;
  operations: ChangesetOperation[];
}

export interface ChangesetApplyResult {
  applied: boolean;
  text: string;
  reason?: "stale_base" | "invalid_range" | "selection_changed";
}

export type QualityAxis =
  | "ai_tell_risk"
  | "fact_integrity"
  | "continuity"
  | "semantic_repetition"
  | "voice_match"
  | "rhythm";

export interface QualitySignal {
  axis: QualityAxis;
  status: "pass" | "watch" | "fail" | "unavailable";
  summary: string;
  evidence?: string[];
}

export interface QualityReport {
  risk: AiTellRiskAssessment;
  signals: QualitySignal[];
}

export type CoauthorEvent =
  | { type: "state"; status: CoauthorRunStatus; message: string }
  | { type: "checkpoint"; title: string; message: string }
  | { type: "changeset_ready"; changeset: Changeset; quality: QualityReport };

export function createContextSnapshot(request: CoauthorRunRequest): StoryContextSnapshot {
  return {
    storyId: request.target.storyId,
    chapterId: request.target.chapterId,
    baseRevision: request.target.baseRevision,
    capturedAt: new Date().toISOString(),
    input: request.input,
    contextManifest: [],
  };
}

export function createCoauthorRun(
  request: CoauthorRunRequest,
  plan: CoauthorPlanStep[] = [],
): CoauthorRun {
  const now = new Date().toISOString();
  return {
    id: `coauthor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: request.mode,
    intent: request.intent,
    goal: request.goal,
    options: request.options,
    status: "queued",
    context: createContextSnapshot(request),
    plan,
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function revisionOf(text: string): string {
  return hashText(text);
}

export function createAppendChangeset(
  baseText: string,
  text: string,
  summary: string,
  reason = "Результат Соавтора",
): Changeset {
  return {
    id: `changeset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    baseRevision: revisionOf(baseText),
    createdAt: new Date().toISOString(),
    summary,
    operations: [{ kind: "append", text, reason }],
  };
}

export function createSelectionChangeset(
  baseText: string,
  range: TextRange,
  text: string,
  summary: string,
  reason = "Бережная переработка Соавтора",
): Changeset {
  const selectedText = baseText.slice(range.start, range.end);
  return {
    id: `changeset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    baseRevision: revisionOf(baseText),
    createdAt: new Date().toISOString(),
    summary,
    operations: [{
      kind: "replace_selection",
      range,
      expectedTextHash: revisionOf(selectedText),
      text,
      reason,
    }],
  };
}

/**
 * Применяет только безопасные, детерминированные текстовые изменения. Если исходная
 * ревизия устарела, функция не меняет текст: пользователь должен увидеть diff.
 */
export function applyChangeset(currentText: string, changeset: Changeset): ChangesetApplyResult {
  if (revisionOf(currentText) !== changeset.baseRevision) {
    return { applied: false, text: currentText, reason: "stale_base" };
  }

  let next = currentText;
  for (const operation of changeset.operations) {
    if (operation.kind === "append") {
      next += operation.text;
      continue;
    }

    if (operation.range.start < 0 || operation.range.end < operation.range.start || operation.range.end > next.length) {
      return { applied: false, text: currentText, reason: "invalid_range" };
    }
    const selected = next.slice(operation.range.start, operation.range.end);
    if (revisionOf(selected) !== operation.expectedTextHash) {
      return { applied: false, text: currentText, reason: "selection_changed" };
    }
    next = `${next.slice(0, operation.range.start)}${operation.text}${next.slice(operation.range.end)}`;
  }

  return { applied: true, text: next };
}

export function qualityReportFromAiTell(
  riskScore: number,
  maxRiskScore: number,
  evidence: string[] = [],
): QualityReport {
  const risk = assessAiTellRisk(riskScore, maxRiskScore);
  const statusByBand: Record<AiTellRiskBand, QualitySignal["status"]> = {
    clear: "pass",
    watch: "watch",
    high: "fail",
  };
  return {
    risk,
    signals: [
      {
        axis: "ai_tell_risk",
        status: statusByBand[risk.band],
        summary: risk.label,
        evidence: evidence.length ? evidence : undefined,
      },
    ],
  };
}
