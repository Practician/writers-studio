import { Chapter, Story } from "../types";

export function chapterOrdinal(title: string): number | null {
  const match = title.match(/(?:глава|chapter)\s*(\d+)/iu);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function findPreviousCanonChapter(chapters: Chapter[], current: Chapter): Chapter | null {
  const currentOrdinal = chapterOrdinal(current.title);
  if (currentOrdinal !== null) {
    const numbered = chapters
      .filter((chapter) => chapter.id !== current.id && chapter.content.trim())
      .map((chapter) => ({ chapter, ordinal: chapterOrdinal(chapter.title) }))
      .filter((entry): entry is { chapter: Chapter; ordinal: number } => entry.ordinal !== null && entry.ordinal < currentOrdinal)
      .sort((left, right) => right.ordinal - left.ordinal);
    if (numbered.length) return numbered[0].chapter;
  }

  const currentIndex = chapters.findIndex((chapter) => chapter.id === current.id);
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (chapters[index].content.trim()) return chapters[index];
  }
  return null;
}

export function canonDossier(story: Story, current: Chapter, previous: Chapter | null): string {
  const localCanon = `${previous?.content ?? ""}\n${current.summary ?? ""}`.toLocaleLowerCase("ru");
  const characterLines = (story.characters ?? [])
    .filter((character) => character.name
      .toLocaleLowerCase("ru")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3)
      .some((token) => localCanon.includes(token)))
    .map((character) => `${character.name}: ${character.role}; ${character.traits}; цель — ${character.goals}`)
    .join("\n");
  return [
    `Текущая глава: ${current.title}.`,
    current.summary?.trim() ? `Обязательные события: ${current.summary.trim()}` : "",
    previous ? `Непосредственное продолжение: ${previous.title}. Не меняй героя, точку зрения, эпоху, экипировку и устройство мира относительно этого текста.` : "",
    characterLines ? `Персонажи книги:\n${characterLines}` : "",
  ].filter(Boolean).join("\n\n");
}
