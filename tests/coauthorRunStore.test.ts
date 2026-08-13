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


test("author voice mode injects the passport and emits an explainable voice signal", async () => {
  const store = new CoauthorRunStore(tempStorePath("author-voice"));
  const sample = "Он не спешил отвечать. Пальцы легли на край стола, и пауза вышла длиннее вопроса. В коридоре щёлкнул выключатель, но никто не вошёл. ".repeat(4);
  const run = createCoauthorRun(request({
    input: {
      baseText: "Он закрыл дверь и прислушался.",
      selectedText: "закрыл дверь",
      chapterTitle: "Глава 1",
      authorSample: sample,
      voiceSheet: { summary: "Сдержанный близкий взгляд", voiceRules: ["Показывай действие"], avoid: ["Не объясняй эмоции"] },
      styleProfile: { version: 1, metrics: { averageSentenceLength: 8 }, patterns: { narrativePace: "сдержанный" } },
    },
    options: {
      humanizeDepth: "balanced",
      model: "test-model",
      authorVoice: { enabled: true, profileRevision: "author-corpus-v1" },
    },
  }));
  store.create(run);

  const completed = await executeCoauthorRun(store, run, async (_system, prompt) => {
    assert.match(prompt, /ПАСПОРТ АВТОРСКОГО ГОЛОСА/);
    assert.match(prompt, /ГЛУБОКИЙ ПРОФИЛЬ/);
    return "Он прикрыл дверь и задержал ладонь на ручке.";
  });

  const voice = completed.quality?.signals.find((signal) => signal.axis === "voice_match");
  assert.ok(voice);
  assert.notEqual(voice?.status, "unavailable");
  assert.match(voice?.summary || "", /Сходство с подтверждённым авторским образцом/);
});

test("author voice mode rejects a missing passport instead of silently falling back", async () => {
  const store = new CoauthorRunStore(tempStorePath("author-voice-missing"));
  const run = createCoauthorRun(request({
    options: {
      humanizeDepth: "balanced",
      model: "test-model",
      authorVoice: { enabled: true, profileRevision: "missing" },
    },
  }));
  store.create(run);

  await assert.rejects(() => executeCoauthorRun(store, run, async () => "не должен вызываться"), /Авторский режим требует/);
});


test("dispatcher records an explainable context manifest before generating", async () => {
  const storePath = tempStorePath("context-manifest");
  const store = new CoauthorRunStore(storePath);
  const run = createCoauthorRun(request({
    input: {
      baseText: "Он закрыл дверь и прислушался.",
      selectedText: "закрыл дверь",
      title: "Лабиринт",
      genre: "психологический триллер",
      chapterTitle: "Глава 1",
      chapterSummary: "Герой замечает первый сбой.",
      previousChapter: "Предыдущая сцена заканчивается тревожным звонком.",
      worldBible: "Лабиринт меняет правила после полуночи.",
      bookPlan: "Первый акт: герой принимает ложное объяснение.",
    },
  }));
  store.create(run);

  const completed = await executeCoauthorRun(store, run, async (_system, prompt) => {
    assert.match(prompt, /Библия мира/);
    assert.match(prompt, /План книги/);
    return "Он прикрыл дверь и замер.";
  });

  const manifest = completed.context.contextManifest;
  assert.ok(manifest.length >= 6);
  assert.equal(manifest.every((item) => item.status === "included" && item.reason.length > 0), true);
  assert.ok(manifest.some((item) => item.sourceType === "world_bible"));
  assert.ok(manifest.some((item) => item.sourceType === "book_plan"));
  assert.ok(manifest.every((item) => item.tokenEstimate > 0));

  const restored = new CoauthorRunStore(storePath).get(completed.id);
  assert.equal(restored?.context.contextManifest.length, manifest.length);
});


test("coauthor injects explicit author rules and exposes them in the manifest", async () => {
  const store = new CoauthorRunStore(tempStorePath("author-rules"));
  const run = createCoauthorRun(request({
    input: {
      baseText: "Он закрыл дверь и прислушался.",
      selectedText: "закрыл дверь",
      chapterTitle: "Глава 1",
      authorRules: {
        must: ["Сохраняй близкий POV"],
        avoid: ["Не использовать слово «вдруг»"],
        preferences: ["Опирайся на действие вместо объяснения эмоции"],
      },
    },
  }));
  store.create(run);

  const completed = await executeCoauthorRun(store, run, async (_system, prompt) => {
    assert.match(prompt, /ЯВНЫЕ ПРАВИЛА АВТОРА/);
    assert.match(prompt, /НЕ ИСПОЛЬЗОВАТЬ: Не использовать слово «вдруг»/);
    return "Он прикрыл дверь и прислушался.";
  });

  const rules = completed.context.contextManifest.find((item) => item.sourceType === "author_rule");
  assert.equal(rules?.relevance, "required");
  assert.match(rules?.reason || "", /приоритет/);
});
