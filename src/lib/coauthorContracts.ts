import { hashText } from "./authorAudit";
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

export interface CoauthorRunRequest {
  mode: CoauthorMode;
  intent: CoauthorIntent;
  target: CoauthorTarget;
  goal: string;
  options: {
    humanizeDepth: "fast" | "balanced" | "maximum";
    model: string;
  };
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
  | { type: "state"; status: "queued" | "planning" | "running" | "awaiting_approval" | "completed" | "cancelled" | "failed"; message: string }
  | { type: "checkpoint"; title: string; message: string }
  | { type: "changeset_ready"; changeset: Changeset; quality: QualityReport };

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
