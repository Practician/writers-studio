/**
 * Действия API, которые создают полноценную главу из контекста книги.
 *
 * Обе ветки используют одинаковый входной контекст, но `generate_final_draft`
 * дополнительно включает полный редакторский конвейер в server.ts.
 */
export type ChapterGenerationAction = "generate_full_chapter" | "generate_final_draft";

export function isChapterGenerationAction(action: unknown): action is ChapterGenerationAction {
  return action === "generate_full_chapter" || action === "generate_final_draft";
}
