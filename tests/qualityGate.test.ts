import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQualityRubric } from "../server/quality/rubric";
import { evaluateCandidateGuards } from "../server/quality/guards";
import { decideDuel, runQualityGate } from "../server/quality";
import { validateQualityGateRequest } from "../server/quality/validation";
import type { QualityGateRequest } from "../server/quality";

const source = "Илья проверил заряд: 20%. Затем он спрятал ключ в карман и пошёл к двери.";
const candidate = "Илья проверил заряд: 20%. Он спрятал ключ в карман и направился к двери.";

function request(overrides: Partial<QualityGateRequest> = {}): QualityGateRequest {
  return {
    requestId: "quality-gate-test",
    sourceText: source,
    candidates: [{ id: "candidate-1", text: candidate, origin: "author_rewrite" }],
    protectedTerms: ["Илья", "ключ"],
    context: {
      title: "Тест",
      genre: "Фантастика",
      description: "",
      chapterTitle: "Глава 1",
      chapterSummary: "Герой идёт к двери.",
      worldBible: "",
      bookPlan: "",
      previousChapter: "",
      nextChapterSummary: "",
    },
    voiceSheet: { summary: "Прямая манера", voiceRules: [], avoid: [], evidence: [] },
    analysis: {},
    rubricPreset: "author_edit",
    criticModel: "test-critic",
    judgeModel: "test-judge",
    ...overrides,
  };
}

function criticResponse() {
  return JSON.stringify({
    totalScore: 96,
    dimensions: [
      { dimensionId: "canon", score: 30, finding: "Факты сохранены.", severity: "none" },
      { dimensionId: "continuity", score: 20, finding: "Последовательность сохранена.", severity: "none" },
      { dimensionId: "voice", score: 19, finding: "Голос сохранён.", severity: "none" },
      { dimensionId: "scene_value", score: 14, finding: "Действие стало яснее.", severity: "none" },
      { dimensionId: "clarity", score: 13, finding: "Фраза стала компактнее.", severity: "none" },
    ],
    blockingIssues: [],
    summary: "Кандидат сохраняет смысл и улучшает ясность.",
  });
}

test("quality rubric is fixed at 100 points", () => {
  const rubric = buildQualityRubric();
  assert.equal(rubric.totalWeight, 100);
  assert.equal(rubric.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0), 100);
  assert.deepEqual(rubric.dimensions.map((dimension) => dimension.id), ["canon", "continuity", "voice", "scene_value", "clarity"]);
});

test("guards reject a candidate that changes a protected number", () => {
  const changedNumber = "Илья проверил заряд: 30%. Затем он спрятал ключ в карман и пошёл к двери.";
  const report = evaluateCandidateGuards(request(), { id: "bad", text: changedNumber, origin: "manual" });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((issue) => issue.code === "MISSING_NUMBER"));
  assert.ok(report.issues.some((issue) => issue.code === "ADDED_NUMBER"));
});

test("guards reject a candidate that changes paragraph structure", () => {
  const restructured = "Илья проверил заряд: 20%.\n\nЗатем он спрятал ключ в карман и пошёл к двери.";
  const report = evaluateCandidateGuards(request(), { id: "bad", text: restructured, origin: "manual" });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((issue) => issue.code === "STRUCTURE_CHANGED"));
});

test("duel keeps a candidate only after two confident candidate wins", () => {
  assert.equal(decideDuel(true, false, [
    { order: "SOURCE_FIRST", winner: "CANDIDATE", confidence: 0.8, reason: "Лучше" },
    { order: "CANDIDATE_FIRST", winner: "CANDIDATE", confidence: 0.7, reason: "Лучше" },
  ]), "KEEP_RECOMMENDED");
  assert.equal(decideDuel(true, false, [
    { order: "SOURCE_FIRST", winner: "CANDIDATE", confidence: 0.9, reason: "Лучше" },
    { order: "CANDIDATE_FIRST", winner: "SOURCE", confidence: 0.9, reason: "Лучше" },
  ]), "NEEDS_AUTHOR_REVIEW");
  assert.equal(decideDuel(false, false, [
    { order: "SOURCE_FIRST", winner: "CANDIDATE", confidence: 1, reason: "Лучше" },
    { order: "CANDIDATE_FIRST", winner: "CANDIDATE", confidence: 1, reason: "Лучше" },
  ]), "DISCARD");
});

test("quality gate maps order-inverted votes and recommends a verified candidate", async () => {
  const responses = [
    criticResponse(),
    JSON.stringify({ winner: "B", confidence: 0.9, reason: "Версия B точнее и естественнее." }),
    JSON.stringify({ winner: "A", confidence: 0.9, reason: "Версия A точнее и естественнее." }),
  ];
  let calls = 0;
  const result = await runQualityGate(request(), {
    generate: async () => {
      const response = responses[calls];
      calls += 1;
      return response;
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.decision, "KEEP_RECOMMENDED");
  assert.equal(result.recommendedCandidateId, "candidate-1");
  assert.equal(result.candidates[0].pairwise?.[0].winner, "CANDIDATE");
  assert.equal(result.candidates[0].pairwise?.[1].winner, "CANDIDATE");
  assert.equal(result.nextAction, "AUTHOR_CONFIRM");
});

test("quality gate fails closed without calling a model when all candidates are blocked", async () => {
  let calls = 0;
  const result = await runQualityGate(request({
    candidates: [{ id: "bad", text: "Илья проверил заряд: 21%. Затем он пошёл к двери.", origin: "manual" }],
  }), {
    generate: async () => {
      calls += 1;
      return criticResponse();
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.decision, "DISCARD");
  assert.equal(result.nextAction, "KEEP_SOURCE");
});

test("request validation limits Quality Gate to three candidates", () => {
  assert.throws(() => validateQualityGateRequest({
    sourceText: source,
    candidates: Array.from({ length: 4 }, (_, index) => ({ text: `${candidate} ${index}` })),
  }), /от 1 до 3/u);
});
