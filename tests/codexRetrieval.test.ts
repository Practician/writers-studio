import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexContext, indexCodexMentions, isCodexEntryActive, retrieveCodexEntries } from "../src/lib/codexRetrieval";
import type { Chapter, CodexEntry } from "../src/types";

const chapters: Chapter[] = [
  { id: "c1", title: "Глава 1", summary: "", content: "Ника приехала к старому вокзалу." },
  { id: "c2", title: "Глава 2", summary: "", content: "Ника встретила Хранителя в тоннеле." },
  { id: "c3", title: "Глава 3", summary: "", content: "Тоннель исчез после полуночи." },
];

const entries: CodexEntry[] = [
  {
    id: "nika",
    storyId: "story",
    type: "character",
    name: "Ника",
    aliases: ["Ник"],
    description: "Главная героиня, которая ищет путь домой через тоннель.",
    tags: ["героиня", "тоннель"],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "old-rule",
    storyId: "story",
    type: "lore",
    name: "Старое правило",
    description: "Утраченный порядок прохода через станцию.",
    tags: ["станция"],
    temporal: { validToChapterId: "c1" },
    createdAt: 1,
    updatedAt: 1,
  },
];

test("temporal Codex excludes facts outside the current chapter range", () => {
  assert.equal(isCodexEntryActive(entries[1], chapters, "c1"), true);
  assert.equal(isCodexEntryActive(entries[1], chapters, "c2"), false);
});

test("Codex mention index resolves names and aliases in manuscript chapters", () => {
  const indexed = indexCodexMentions(entries, chapters);
  const nika = indexed.find((entry) => entry.id === "nika");
  assert.ok(nika?.mentions?.some((mention) => mention.chapterId === "c1" && mention.matchedTerm === "Ника"));
  assert.ok(nika?.mentions?.some((mention) => mention.chapterId === "c2" && mention.matchedTerm === "Ника"));
});

test("local hybrid retrieval returns active Codex facts with explainable context", () => {
  const indexed = indexCodexMentions(entries, chapters);
  const hits = retrieveCodexEntries(indexed, chapters, "c2", "Ника снова идёт через тоннель к станции", 4);
  assert.equal(hits[0]?.entryId, "nika");
  assert.equal(hits.some((hit) => hit.entryId === "old-rule"), false);
  assert.match(buildCodexContext(hits), /Кодекс: Ника/);
  assert.match(hits[0]?.reason || "", /совпадение|близость/);
});
