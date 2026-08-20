import type { AuthorEditAudit, AuthorVoiceSheet } from "../../src/types";
import type { AuthorRewriteContext } from "../authorPipeline";

export type QualityDecision = "KEEP_RECOMMENDED" | "DISCARD" | "NEEDS_AUTHOR_REVIEW";
export type GuardSeverity = "warning" | "blocking";
export type CandidateOrigin = "author_rewrite" | "touchup" | "manual" | "generation";
export type RubricPreset = "author_edit" | "scene_revision";

export interface QualityCandidate {
  id: string;
  text: string;
  origin: CandidateOrigin;
  diagnostics?: {
    aiTellScore?: number;
    burstiness?: number;
    changedBlockShare?: number;
  };
}

export type QualityDimensionId = "canon" | "continuity" | "voice" | "scene_value" | "clarity";

export interface QualityDimension {
  id: QualityDimensionId;
  title: string;
  weight: number;
  description: string;
}

export interface QualityRubric {
  id: string;
  version: "v1";
  dimensions: QualityDimension[];
  totalWeight: 100;
}

export interface GuardIssue {
  code: string;
  severity: GuardSeverity;
  message: string;
  blockIndex?: number;
}

export interface CandidateGuardReport {
  candidateId: string;
  passed: boolean;
  issues: GuardIssue[];
  deterministic: {
    missingTerms: string[];
    missingNumbers: string[];
    addedNumbers: string[];
    structureChanged: boolean;
    editScopeExceeded: boolean;
  };
}

export interface DimensionAssessment {
  dimensionId: QualityDimensionId;
  score: number;
  finding: string;
  severity: GuardSeverity | "none";
}

export interface CriticAssessment {
  candidateId: string;
  totalScore: number;
  dimensions: DimensionAssessment[];
  blockingIssues: string[];
  summary: string;
}

export interface PairwiseVote {
  order: "SOURCE_FIRST" | "CANDIDATE_FIRST";
  winner: "SOURCE" | "CANDIDATE" | "TIE";
  confidence: number;
  reason: string;
}

export interface QualityGateRequest {
  requestId: string;
  sourceText: string;
  candidates: QualityCandidate[];
  protectedTerms: string[];
  context: AuthorRewriteContext;
  voiceSheet: AuthorVoiceSheet;
  analysis: unknown;
  existingAudit?: AuthorEditAudit;
  rubricPreset?: RubricPreset;
  criticModel: string;
  judgeModel: string;
}

export interface QualityCandidateResult {
  id: string;
  guards: CandidateGuardReport;
  critic?: CriticAssessment;
  pairwise?: PairwiseVote[];
}

export interface QualityGateResponse {
  runId: string;
  decision: QualityDecision;
  recommendedCandidateId?: string;
  rubric: QualityRubric;
  candidates: QualityCandidateResult[];
  summary: string;
  nextAction: "AUTHOR_CONFIRM" | "KEEP_SOURCE" | "MANUAL_COMPARE";
  metadata: {
    criticModel: string;
    judgeModel: string;
    criticPromptVersion: string;
    judgePromptVersion: string;
    modelSeparation: "same_model" | "different_models";
  };
}

export type QualityGenerate = (params: {
  model: string;
  contents: string;
  systemInstruction: string;
  temperature: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  maxOutputTokens?: number;
}) => Promise<string>;

export interface QualityGateOptions {
  generate: QualityGenerate;
}

export interface QualityGateHttpRequest {
  requestId: string;
  sourceText: string;
  candidates: Array<{
    id?: string;
    text: string;
    origin?: CandidateOrigin;
    diagnostics?: QualityCandidate["diagnostics"];
  }>;
  protectedTerms?: string[];
  context?: Partial<AuthorRewriteContext>;
  voiceSheet?: AuthorVoiceSheet;
  analysis?: unknown;
  rubricPreset?: RubricPreset;
  criticModel?: string;
  judgeModel?: string;
}
