import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAX_AI_TELL_SCORE,
  assessAiTellRisk,
  normalizeMaxAiTellScore,
} from "../src/lib/coauthorQuality";
import {
  applyChangeset,
  createAppendChangeset,
  qualityReportFromAiTell,
  revisionOf,
} from "../src/lib/coauthorContracts";

test("AI-tell risk uses a maximum threshold: lower is better", () => {
  assert.equal(normalizeMaxAiTellScore(undefined), DEFAULT_MAX_AI_TELL_SCORE);
  assert.equal(normalizeMaxAiTellScore(0), 0);
  assert.equal(normalizeMaxAiTellScore(100), 60);

  const clean = assessAiTellRisk(8, 18);
  const watch = assessAiTellRisk(22, 18);
  const high = assessAiTellRisk(40, 18);

  assert.equal(clean.passed, true);
  assert.equal(clean.band, "clear");
  assert.equal(watch.passed, false);
  assert.equal(watch.band, "watch");
  assert.equal(high.band, "high");
});

test("append changeset applies only to the original base revision", () => {
  const base = "Первая строка.";
  const changeset = createAppendChangeset(base, "\nВторая строка.", "Продолжение сцены");

  const applied = applyChangeset(base, changeset);
  assert.deepEqual(applied, { applied: true, text: "Первая строка.\nВторая строка." });

  const stale = applyChangeset("Первая строка. Автор уже внёс правку.", changeset);
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, "stale_base");
});

test("selection replacement rejects changed selection instead of overwriting author edits", () => {
  const base = "Она закрыла дверь.";
  const changeset = {
    id: "test-selection",
    baseRevision: revisionOf(base),
    createdAt: "2026-08-13T00:00:00.000Z",
    summary: "Сделать действие конкретнее",
    operations: [{
      kind: "replace_selection" as const,
      range: { start: 4, end: 11 },
      expectedTextHash: revisionOf("закрыла"),
      text: "захлопнула",
      reason: "Уточнение действия",
    }],
  };

  const applied = applyChangeset(base, changeset);
  assert.deepEqual(applied, { applied: true, text: "Она захлопнула дверь." });

  const mutatedOperation = { ...changeset, operations: [{ ...changeset.operations[0], expectedTextHash: revisionOf("открыла") }] };
  const rejected = applyChangeset(base, mutatedOperation);
  assert.equal(rejected.applied, false);
  assert.equal(rejected.reason, "selection_changed");
});

test("quality report exposes an explanatory AI-tell signal", () => {
  const report = qualityReportFromAiTell(27, 18, ["штамп «важно понять»"]);
  assert.equal(report.risk.passed, false);
  assert.equal(report.signals[0]?.axis, "ai_tell_risk");
  assert.equal(report.signals[0]?.status, "watch");
  assert.deepEqual(report.signals[0]?.evidence, ["штамп «важно понять»"]);
});
