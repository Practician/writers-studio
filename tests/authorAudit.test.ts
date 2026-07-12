import test from "node:test";
import assert from "node:assert/strict";
import { auditStyleSignals, compareStyle, computeStyleStats, hashText, wordsOf } from "../src/lib/authorAudit";
import { diffParagraphs } from "../src/lib/textDiff";

test("style statistics handle Russian prose", () => {
  const text = "Я остановился. Тишина навалилась на меня!\n\n— Ну, идём дальше…";
  const stats = computeStyleStats(text);
  assert.equal(wordsOf(text).length, 9);
  assert.ok(stats.sentences >= 3);
  assert.ok(stats.exclamationsPerThousandWords > 0);
  assert.ok(stats.dialogueLineShare > 0);
});

test("style audit reports signals without pretending to prove authorship", () => {
  const signals = auditStyleSignals("Паника навалилась. Не просто страх. В тот самый момент всё исчезло.");
  assert.ok(signals.some((signal) => signal.category === "Шаблонные обороты"));
  assert.ok(signals.some((signal) => signal.category === "Абстрактные действующие лица"));
});

test("style comparison and text hash are deterministic", () => {
  const sample = "Ну, что ж. Я пошёл дальше!\n\nОднако выбора не было…";
  const comparison = compareStyle(sample, sample);
  assert.equal(comparison.similarity, 100);
  assert.equal(hashText(sample), hashText(sample));
  assert.notEqual(hashText(sample), hashText(`${sample}!`));
});

test("paragraph diff preserves additions and removals", () => {
  const diff = diffParagraphs("Первый.\n\nСтарый.", "Первый.\n\nНовый.");
  assert.deepEqual(diff.map((item) => item.kind), ["equal", "removed", "added"]);
});
