import test from "node:test";
import assert from "node:assert/strict";
import {
  aiTellScore,
  detectAiTells,
  repeatedOpenerShare,
  sentenceBurstiness,
  voicePresetById,
  VOICE_PRESETS,
} from "../server/humanStyle";
import { priorityStyleBlockIndexes } from "../server/authorPipeline";

test("catalog detects both legacy and new generative clichés", () => {
  const text = "Это было не просто утро. Волна ужаса накрыла его, и время словно остановилось. Повисла гробовая тишина.";
  const hits = detectAiTells(text);
  const ids = hits.map((hit) => hit.id);
  assert.ok(ids.includes("ne-prosto"));
  assert.ok(ids.includes("vremya-zamerlo"));
  assert.ok(ids.includes("grobovaya-tishina"));
});

test("bureaucratic language is flagged", () => {
  const hits = detectAiTells("Данный лес является местом силы и представляет собой аномалию.");
  const categories = new Set(hits.map((hit) => hit.category));
  assert.ok(categories.has("bureaucratic"));
  assert.ok(hits.length >= 3);
});

test("burstiness is low for uniform sentences and high for varied ones", () => {
  const uniform = "Он вошёл в тёмный зал и осмотрелся вокруг. Она сидела у окна и читала старую книгу. Ветер стучал в раму и гнул сухие ветки. Лампа мигала над столом и чертила тени.";
  const varied = "Тихо. Он вошёл в зал, где под потолком, среди пыльных знамён и обрывков паутины, ещё жила память о былых праздниках, и остановился. Шаг. Ещё один.";
  assert.ok(sentenceBurstiness(uniform) < sentenceBurstiness(varied));
});

test("repeated sentence openers are measured", () => {
  const monotone = "Он встал. Он оделся. Он вышел. Он закурил.";
  const varied = "Он встал. Утро не обещало ничего. Сигарета нашлась в кармане.";
  assert.ok(repeatedOpenerShare(monotone) > 0.9);
  assert.equal(repeatedOpenerShare(varied), 0);
});

test("ai-tell score is bounded and orders texts sensibly", () => {
  const robotic = "Это был не просто дом. Волна страха накрыла её с пугающей скоростью. Время словно остановилось в тот самый момент. Повисла гробовая тишина перед лицом опасности.";
  const human = "Дом стоял косо, как забытая на веранде табуретка. Марта пнула калитку. Заскрипело. Где-то внизу, под террасой, завозилась соседская такса, и ей вдруг стало смешно от собственного страха.";
  const roboticScore = aiTellScore(robotic);
  const humanScore = aiTellScore(human);
  assert.ok(roboticScore.score > humanScore.score);
  assert.ok(roboticScore.score <= 100 && humanScore.score >= 0);
  assert.ok(humanScore.score < 30);
});

test("priority blocks derive from the shared catalog", () => {
  const blocks = [
    "Обычный абзац про завтрак и дорогу до станции.",
    "Сердце пропустило удар, и волна паники захлестнула его.",
  ];
  assert.deepEqual(priorityStyleBlockIndexes(blocks), [1]);
});

test("voice presets are unique and resolvable", () => {
  const ids = VOICE_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(voicePresetById("terse")?.title, "Резкий, рубленый");
  assert.equal(voicePresetById("nope"), undefined);
  assert.equal(voicePresetById(42), undefined);
});
