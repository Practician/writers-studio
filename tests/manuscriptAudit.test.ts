import assert from "node:assert/strict";
import test from "node:test";
import { auditManuscript } from "../src/lib/manuscriptAudit";
import type { Story } from "../src/types";

function story(): Story {
  return {
    id: "audit-story",
    title: "Аудит",
    description: "",
    genre: "триллер",
    characters: [],
    worldRules: [],
    updatedAt: 1,
    chapters: [
      { id: "c1", title: "Глава 1", summary: "Первый переход", content: "Ника идёт по тоннелю и слышит, как поезд останавливается в темноте. Она считает ступени и не оглядывается." },
      { id: "c2", title: "Глава 2", summary: "", content: "Ника идёт по тоннелю и слышит, как поезд останавливается в темноте. Она считает ступени и не оглядывается." },
      { id: "c3", title: "Глава 3", summary: "Финал", content: "" },
    ],
  };
}

test("whole-manuscript audit reports duplicates, incomplete structure, and temporal canon conflicts", () => {
  const draft = story();
  const report = auditManuscript(draft, [{
    id: "keeper",
    storyId: draft.id,
    type: "character",
    name: "Хранитель",
    description: "Появляется только после первого перехода.",
    tags: [],
    temporal: { validFromChapterId: "c2" },
    createdAt: 1,
    updatedAt: 1,
  }]);

  assert.equal(report.chapterCount, 3);
  assert.ok(report.issues.some((issue) => issue.category === "duplicate" && issue.chapterId === "c2"));
  assert.ok(report.issues.some((issue) => issue.category === "structure" && issue.severity === "blocking" && issue.chapterId === "c3"));
  assert.ok(report.issues.some((issue) => issue.category === "structure" && issue.title === "Нет синопсиса главы" && issue.chapterId === "c2"));
});

test("whole-manuscript audit detects a fact mentioned outside its temporal range", () => {
  const draft = story();
  draft.chapters[0].content += " Хранитель оставил на полу ключ.";
  const report = auditManuscript(draft, [{
    id: "keeper",
    storyId: draft.id,
    type: "character",
    name: "Хранитель",
    description: "Появляется только после первого перехода.",
    tags: [],
    temporal: { validFromChapterId: "c2" },
    createdAt: 1,
    updatedAt: 1,
  }]);

  const conflict = report.issues.find((issue) => issue.category === "temporal_canon");
  assert.equal(conflict?.chapterId, "c1");
  assert.equal(conflict?.relatedCodexEntryId, "keeper");
});
