import test from "node:test";
import assert from "node:assert/strict";
import { aiTellScore, pickBestChapterCandidate, rankChapterCandidate, resolveHumanizeDepth } from "../server/humanStyle";
import { humanizeProseDraft, rewriteDetectorAiSegments, runTouchupPipeline } from "../server/chapterGenerate";

test("touchup pipeline removes catalog stamps via mock model", async () => {
  const source = [
    "Я шёл вдоль стены и считал шаги.",
    "",
    "Это был не просто коридор. Волна ужаса накрыла меня, и время словно остановилось. Сердце пропустило удар.",
    "",
    "Я достал ключ и вырезал метку на стене. Синий свет заполнил борозду.",
  ].join("\n");

  const before = aiTellScore(source);
  assert.ok(before.score >= 20, `expected dirty source, got ${before.score}`);
  assert.ok(before.hits.length >= 2);

  const generate = async (params: {
    contents: string;
    responseMimeType?: string;
  }) => {
    // Mock returns cleaned blocks for JSON touchup requests.
    if (params.responseMimeType === "application/json" || params.contents.includes("priority-blocks")) {
      const match = params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
      assert.ok(match, "expected priority-blocks payload");
      const targets = JSON.parse(match![1]) as Array<{ text: string }>;
      const blocks = targets.map((target) =>
        target.text
          .replace(/Это был не просто коридор\./iu, "Коридор был узкий и сухой.")
          .replace(/Волна ужаса накрыла меня,?\s*/iu, "")
          .replace(/время словно остановилось\.?/iu, "Я перестал слышать собственное дыхание.")
          .replace(/Сердце пропустило удар\.?/iu, "Пальцы сами сжали ключ."),
      );
      return JSON.stringify({ blocks });
    }
    return source;
  };

  const result = await runTouchupPipeline(source, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    depth: resolveHumanizeDepth("balanced"),
  });

  const after = aiTellScore(result.text);
  assert.ok(result.refinedBlocks >= 1, "should refine at least one block");
  assert.ok(after.score < before.score, `score should drop: ${before.score} -> ${after.score}`);
  assert.equal(after.hits.filter((hit) => hit.id === "volna-chuvstva").length, 0);
  assert.equal(after.hits.filter((hit) => hit.id === "vremya-zamerlo").length, 0);
});

test("humanizeProseDraft report includes gate fields", async () => {
  const clean = "Я шёл. Стена была тёплой. Шаг. Ещё шаг. Ключ звенел в кармане.";
  const generate = async () => JSON.stringify({ blocks: [clean] });
  const result = await humanizeProseDraft(clean, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
  });
  assert.equal(typeof result.humanizeReport.gatePassed, "boolean");
  assert.equal(result.humanizeReport.depth, "fast");
  assert.equal(result.humanizeReport.mode, "single");
  assert.ok(result.humanizeReport.scoreAfter <= 20);
});

test("pickBestChapterCandidate prefers lower AI-tell and higher burstiness", () => {
  const dirty = {
    text: "a",
    score: aiTellScore("Это был не просто страх. Волна ужаса накрыла его, и время словно остановилось."),
    index: 0,
  };
  const clean = {
    text: "b",
    score: aiTellScore("Я шёл. Ключ. Стена. Сорок один шаг. Тишина."),
    index: 1,
  };
  const best = pickBestChapterCandidate([dirty, clean], 12, 0.45);
  assert.equal(best.index, 1);
  assert.ok(rankChapterCandidate(clean.score) < rankChapterCandidate(dirty.score));
});

test("rewriteDetectorAiSegments rewrites only AI labels", async () => {
  const segments = [
    { text: "Человеческий кусок без формул. Я сел и выпил воды.", label: "HUMAN" },
    { text: "Волна ужаса накрыла его, и время словно остановилось перед лицом тьмы.", label: "AI" },
    { text: "Потом я встал и пошёл дальше по коридору.", label: "LIKELY_HUMAN" },
  ];
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    if (params.contents.includes("ai-segments") || params.responseMimeType === "application/json") {
      const match = params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/)
        || params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
      if (match) {
        const targets = JSON.parse(match[1]) as Array<{ text: string }>;
        return JSON.stringify({
          blocks: targets.map((target) =>
            target.text
              .replace(/Волна ужаса накрыла его,?\s*/iu, "")
              .replace(/время словно остановилось[^.]*\.?/iu, "Он замер у стены.")
              .replace(/перед лицом тьмы\.?/iu, ""),
          ),
        });
      }
      return JSON.stringify({ blocks: ["Он замер у стены. Пальцы сжали ключ."] });
    }
    return segments.map((s) => s.text).join("");
  };

  const result = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    humanizeDepth: "fast",
  });
  assert.ok(result.rewrittenCount >= 1);
  assert.ok(result.humanizeReport.detectorSegmentsRewritten! >= 1);
  // HUMAN-фрагмент должен сохраниться
  assert.ok(result.text.includes("выпил воды") || result.text.includes("Человеческий"));
  assert.ok(!result.text.includes("Волна ужаса") || result.humanizeReport.scoreAfter <= result.humanizeReport.scoreBefore);
});
