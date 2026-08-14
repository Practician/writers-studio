import assert from "node:assert/strict";
import test from "node:test";
import { isChapterGenerationAction } from "../server/writerActions";

test("full-draft action is accepted by the chapter-generation contract", () => {
  assert.equal(isChapterGenerationAction("generate_full_chapter"), true);
  assert.equal(isChapterGenerationAction("generate_final_draft"), true);
  assert.equal(isChapterGenerationAction("continue"), false);
  assert.equal(isChapterGenerationAction("invalid_action"), false);
});
