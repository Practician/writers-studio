import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LABYRINTH_CANON_MARKER,
  LABYRINTH_STORY_ID,
  buildLabyrinthStory,
  mergeLabyrinthCanonIntoStories,
} from "../src/data/labyrinthCanon";
import type { Story } from "../src/types";

describe("labyrinthCanon", () => {
  it("seed has bible marker, plan, rings rule, ch5–6 content", () => {
    const story = buildLabyrinthStory(1);
    assert.equal(story.id, LABYRINTH_STORY_ID);
    assert.ok(story.worldBible?.includes(LABYRINTH_CANON_MARKER));
    assert.ok(story.bookPlan?.includes("3 кольца"));
    assert.ok(story.worldRules.some((r) => r.id === "lr-rings-puzzle"));
    assert.ok(story.worldRules.some((r) => r.id === "lr-detector-yandex"));
    assert.ok(!/минимум местоимения «я»/i.test(story.worldBible || ""));
    assert.ok(/умеренно/i.test(story.worldRules.find((r) => r.id === "lr-style")?.content || ""));
    const ch5 = story.chapters.find((c) => /глава\s*5/i.test(c.title));
    const ch6 = story.chapters.find((c) => /глава\s*6/i.test(c.title));
    assert.ok(ch5?.content && ch5.content.length > 500);
    assert.ok(ch6?.content && ch6.content.length > 500);
    assert.ok(ch6?.summary.includes("12 секторов"));
    assert.ok(/2%/.test(ch5?.content || ""));
  });

  it("merge prepends labyrinth when missing", () => {
    const other: Story = {
      id: "story-1",
      title: "Other",
      genre: "x",
      description: "",
      characters: [],
      chapters: [{ id: "c1", title: "Глава 1", summary: "", content: "hi" }],
      worldRules: [],
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([other]);
    assert.equal(merged[0].id, LABYRINTH_STORY_ID);
    assert.equal(merged[1].id, "story-1");
  });

  it("merge patches existing labyrinth ch5–6 and bible", () => {
    const existing: Story = {
      id: LABYRINTH_STORY_ID,
      title: "Лабиринт. Путь домой",
      genre: "t",
      description: "old",
      characters: [],
      chapters: [
        {
          id: "x5",
          title: "Глава 5. Первый круг",
          summary: "old",
          content: "устаревший конец",
        },
        {
          id: "x6",
          title: "Глава 6. Число 20",
          summary: "old",
          content: "Начну снова. Свет вдали.",
        },
        {
          id: "x7",
          title: "Глава 7. Отпечаток ладони",
          summary: "old",
          content: "уже написанный текст седьмой",
        },
      ],
      worldRules: [],
      worldBible: "old bible",
      bookPlan: "old plan",
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([existing]);
    const s = merged[0];
    assert.ok(s.worldBible?.includes(LABYRINTH_CANON_MARKER));
    assert.ok(s.bookPlan?.includes("12 секторов"));
    const ch6 = s.chapters.find((c) => /глава\s*6/i.test(c.title))!;
    const ch7 = s.chapters.find((c) => /глава\s*7/i.test(c.title))!;
    assert.ok(!ch6.content.includes("Начну снова"));
    assert.ok(ch6.summary.includes("кольца"));
    assert.equal(ch7.content, "уже написанный текст седьмой");
    assert.ok(ch7.summary.includes("20%"));
  });
});
