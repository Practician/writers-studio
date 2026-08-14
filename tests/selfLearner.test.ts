import test from "node:test";
import assert from "node:assert/strict";
import { learnFromEdits } from "../server/agent/selfLearner";
import { buildStyleInstructionBlock, type DeepStyleProfile } from "../server/agent/styleProfiler";

const profile: DeepStyleProfile = {
  voiceSheet: {
    summary: "Сдержанный близкий POV",
    voiceRules: ["Опирайся на действие и конкретную деталь"],
    avoid: ["Объясняющие выводы"],
    evidence: [],
  },
  metrics: {
    avgSentenceLength: 12,
    sentenceLengthVariance: 4,
    avgParagraphLength: 45,
    dialogueToNarrativeRatio: 0.2,
    uniqueWordRatio: 0.6,
    punctuationProfile: { emDashes: 1, semiColons: 0, colons: 0, ellipses: 0, quotes: 2, exclamationMarks: 0, questionMarks: 0 },
    topNGrams: [],
    burstiness: 0.55,
  },
  patterns: {
    openingStyles: [], transitionPhrases: [], dialogueTags: [], sensoryPreferences: [], metaphorTypes: [],
    narrativePace: "сдержанный", emotionalRange: "напряжённый", avoidances: [], frequentVerbs: [], frequentAdverbs: [],
  },
  exemplars: [],
  version: 1,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  sampleCharCount: 500,
};

test("author edit becomes a persistent lesson even when LLM categorization is unavailable", async () => {
  const learned = await learnFromEdits(
    "Комната была очень страшной, и герой понял, что ему нужно уходить.",
    "Лампа мигнула. Я отступил от стола, не выпуская ручку двери.",
    profile,
    "mock",
  );

  assert.ok(learned.lessons.length > 0);
  assert.ok(learned.updatedProfile.learningLessons?.length);
  const instruction = buildStyleInstructionBlock(learned.updatedProfile);
  assert.match(instruction, /УРОКИ ИЗ ПОДТВЕРЖДЁННЫХ ПРАВОК АВТОРА/);
  assert.match(instruction, /Автор предпочитает собственную точную формулировку|Автор убирает лишние объяснения/);
});
