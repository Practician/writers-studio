import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCoauthorRun, revisionOf, type CoauthorRunRequest } from "../src/lib/coauthorContracts";
import { CoauthorRunStore } from "../server/coauthor/runStore";
import { executeCoauthorRun } from "../server/coauthor/dispatcher";

function tempStorePath(label: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `writers-studio-${label}-`)), "runs.json");
}

function request(overrides: Partial<CoauthorRunRequest> = {}): CoauthorRunRequest {
  const baseText = "Он закрыл дверь и прислушался.";
  return {
    mode: "guided",
    intent: "improve",
    goal: "Сделать действие конкретнее",
    target: { storyId: "story-1", chapterId: "chapter-1", baseRevision: revisionOf(baseText) },
    input: { baseText, selectedText: "закрыл дверь", chapterTitle: "Глава 1" },
    options: { humanizeDepth: "balanced", model: "test-model" },
    ...overrides,
  };
}

test("run store persists checkpoints and explicit author feedback", () => {
  const storePath = tempStorePath("store");
  const store = new CoauthorRunStore(storePath);
  const run = createCoauthorRun(request());
  store.create(run);
  store.setStatus(run.id, "running", "Запуск");
  store.addCheckpoint(run.id, "Контекст", "Снимок сохранён");
  store.setFeedback(run.id, "edited", "Сохранил финальную фразу");

  const restored = new CoauthorRunStore(storePath).get(run.id);
  assert.equal(restored?.status, "running");
  assert.equal(restored?.feedback?.decision, "edited");
  assert.equal(restored?.checkpoints.length, 2);
});

test("dispatcher returns a reviewable changeset instead of modifying text directly", async () => {
  const store = new CoauthorRunStore(tempStorePath("dispatcher"));
  const run = createCoauthorRun(request({ mode: "quick" }));
  store.create(run);

  const completed = await executeCoauthorRun(store, run, async (_system, _prompt, model) => {
    assert.equal(model, "test-model");
    return "захлопнул дверь";
  });

  assert.equal(completed.status, "awaiting_approval");
  assert.equal(completed.output, "захлопнул дверь");
  assert.equal(completed.changeset?.operations[0]?.kind, "replace_selection");
  assert.equal(completed.quality?.signals[0]?.axis, "ai_tell_risk");
});

test("planning task returns informational output without a changeset", async () => {
  const store = new CoauthorRunStore(tempStorePath("plan"));
  const run = createCoauthorRun(request({ intent: "plan", input: { baseText: "", chapterTitle: "Глава 2" } }));
  store.create(run);

  const completed = await executeCoauthorRun(store, run, async () => "1. Конфликт\n2. Последствие");

  assert.equal(completed.status, "completed");
  assert.equal(completed.changeset, undefined);
  assert.equal(completed.output, "1. Конфликт\n2. Последствие");
});
