import test from "node:test";
import assert from "node:assert/strict";
import {
  aiTellScore,
  blockQualityIssues,
  changedBlockShare,
  detectAiTells,
  quantitativeVoiceBlock,
  repeatedOpenerShare,
  rhythmIssues,
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

test("block quality guard catches inflation and duplicated draft variants", () => {
  const source = "Я вышел на перрон и огляделся по сторонам.";
  const inflated = source + " " + "Очень длинное продолжение с массой лишних деталей и повторов. ".repeat(8);
  assert.ok(blockQualityIssues(source, inflated).some((issue) => issue.includes("раздут")));

  const duplicated = "Я вышел на пустой перрон и огляделся по сторонам вокзала. Я вышел на пустой перрон и осмотрелся по сторонам вокзала.";
  assert.ok(blockQualityIssues(duplicated, duplicated).some((issue) => issue.includes("одинаковых")));

  assert.deepEqual(blockQualityIssues(source, "Я вышел на перрон. Пусто."), []);
});

test("rhythm issues flag flat cadence and repeated openers", () => {
  const flat = "Он вошёл в тёмный зал и осмотрелся вокруг себя. Он сел на скамью у стены и достал сигареты. Он закурил быстро и глубоко затянулся дымом. Он ждал начала собрания уже очень долго.";
  const issues = rhythmIssues(flat);
  assert.ok(issues.some((issue) => issue.includes("ритм")) || issues.some((issue) => issue.includes("зачины")));
  const lively = "Тихо. Он вошёл в зал, где под потолком среди пыльных знамён ещё жила память о праздниках, и замер у двери. Шаг. Куда теперь?";
  assert.deepEqual(rhythmIssues(lively), []);
});

test("changed block share distinguishes cosmetic and substantive edits", () => {
  const source = ["Первый абзац текста.", "Второй абзац текста.", "Третий абзац текста."];
  const cosmetic = ["Первый абзац текста!", "Второй абзац — текста.", "Третий абзац текста…"];
  assert.equal(changedBlockShare(source, cosmetic), 0);
  const substantive = ["Совсем другой первый абзац.", "Второй абзац текста.", "И новый третий."];
  assert.ok(changedBlockShare(source, substantive) > 0.6);
});

test("quantitative voice block reports measurable stats for long samples", () => {
  const sample = ("Я шёл домой. Дождь лил как из ведра, и вода неслась по проспекту, закручиваясь спиралями. Ну что ж… Придётся бежать! ".repeat(20));
  const block = quantitativeVoiceBlock(sample);
  assert.ok(block.includes("средняя длина предложения"));
  assert.ok(block.includes("многоточия"));
  assert.equal(quantitativeVoiceBlock("Мало текста."), "");
});

test("voice presets are unique and resolvable", () => {
  const ids = VOICE_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(voicePresetById("terse")?.title, "Резкий, рубленый");
  assert.equal(voicePresetById("nope"), undefined);
  assert.equal(voicePresetById(42), undefined);
});
