import test from "node:test";
import assert from "node:assert/strict";
import { canonDossier, chapterOrdinal, findPreviousCanonChapter } from "../src/lib/chapterContext";
import { Chapter, Story } from "../src/types";

const chapter = (id: string, title: string, content = "текст"): Chapter => ({ id, title, summary: "", content });

test("chapter ordinal recognizes Russian and English titles", () => {
  assert.equal(chapterOrdinal("Глава 6: Медовый коридор"), 6);
  assert.equal(chapterOrdinal("Chapter 12 — Return"), 12);
  assert.equal(chapterOrdinal("Эпилог"), null);
});

test("semantic predecessor wins over stale array order", () => {
  const chapters = [
    chapter("five", "Глава 5: Петля"),
    chapter("demo", "Глава 2: Демонстрационная глава"),
    chapter("six", "Глава 6: Медовый коридор", ""),
  ];
  assert.equal(findPreviousCanonChapter(chapters, chapters[2])?.id, "five");
});

test("canon dossier pins continuity and named characters", () => {
  const current = chapter("six", "Глава 6", "");
  current.summary = "Герой входит в правый проход";
  const previous = chapter("five", "Глава 5: Петля", "Алексей вошёл в правый проход.");
  const story = { characters: [{ name: "Алексей", role: "герой", traits: "ироничный", goals: "выбраться" }] } as Story;
  const dossier = canonDossier(story, current, previous);
  assert.match(dossier, /Не меняй героя/);
  assert.match(dossier, /Алексей/);
  assert.match(dossier, /правый проход/);
});
