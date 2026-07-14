export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  traits: string;
  goals: string;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  content: string;
  isPublished?: boolean;
}

export interface WorldRule {
  id: string;
  title: string;
  content: string;
}

export interface Story {
  id: string;
  title: string;
  description: string;
  genre: string;
  characters: Character[];
  chapters: Chapter[];
  worldRules: WorldRule[];
  updatedAt: number;
  bookPlan?: string;
  worldBible?: string;
}

export interface TextSelection {
  chapterId: string;
  start: number;
  end: number;
  text: string;
  sourceHash: string;
}

export interface AuthorVoiceEvidence {
  quote: string;
  observation: string;
}

export interface AuthorVoiceSheet {
  summary: string;
  voiceRules: string[];
  avoid: string[];
  evidence: AuthorVoiceEvidence[];
}

export interface AuthorProfileRecord {
  storyId: string;
  sample: string;
  sampleFileName?: string;
  styleDescription: string;
  protectedTerms: string[];
  voiceSheet?: AuthorVoiceSheet;
  updatedAt: number;
}

export interface AuthorEditIssue {
  severity: "warning" | "blocking";
  sourceFact?: string;
  problem: string;
}

export interface AuthorEditAudit {
  passed: boolean;
  summary: string;
  factIssues: AuthorEditIssue[];
  protectedTermIssues: string[];
  voiceNotes: string[];
  naturalnessNotes: string[];
}

export interface AuthorEditTarget {
  chapterId: string;
  kind: "selection" | "chapter" | "detector-segment";
  original: string;
  sourceHash: string;
  start?: number;
  end?: number;
}

export interface AuthorRevisionRecord {
  id: string;
  storyId: string;
  chapterId: string;
  storyChapterKey: string;
  createdAt: number;
  original: string;
  revised: string;
  target: AuthorEditTarget;
  audit: AuthorEditAudit;
  applied: boolean;
  model: string;
}

export interface HumanizeReport {
  scoreBefore: number;
  scoreAfter: number;
  refinedBlocks: number;
  flaggedLabels: string[];
  unresolvedLabels?: string[];
  burstiness?: number;
  openerRepetition?: number;
  patternDensity?: number;
  gatePassed?: boolean;
  passesRun?: number;
  scenesGenerated?: number;
  depth?: "fast" | "balanced" | "maximum";
  mode?: "single" | "scenes";
  candidatesTried?: number;
  candidateScores?: number[];
  chosenCandidate?: number;
  detectorSegmentsRewritten?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
