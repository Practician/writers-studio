import type { Chapter, CodexEntry, CodexMention } from "../types";

export interface CodexRetrievalHit {
  entryId: string;
  label: string;
  excerpt: string;
  reason: string;
  score: number;
}

const STOP_WORDS = new Set([
  "и", "в", "во", "на", "не", "что", "как", "для", "это", "его", "ее", "она", "они", "он", "но", "по", "из", "за", "от", "до", "со", "к", "у", "а", "или", "же", "бы", "ли", "мы", "вы", "я", "ты", "их", "так", "то", "с", "о",
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();
}

function stem(token: string): string {
  return token.replace(/(иями|ями|ами|ого|ему|ами|ями|иях|иях|ость|ости|ение|ения|ировать|ировать|ется|утся|ешь|ете|ать|ять|ить|еть|ого|ому|ими|ыми|ая|яя|ое|ее|ые|ие|ий|ый|ой|ам|ям|ах|ях|ов|ев|ом|ем|ой|ей|ую|юю|а|я|ы|и|у|ю|е|о)$/u, "");
}

function tokens(value: string): string[] {
  return [...new Set(normalize(value).split(/\s+/u).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))];
}

function trigrams(value: string): Set<string> {
  const source = ` ${normalize(value)} `;
  const result = new Set<string>();
  for (let index = 0; index <= source.length - 3; index += 1) result.add(source.slice(index, index + 3));
  return result;
}

function overlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const values = new Set(right);
  return left.filter((token) => values.has(token)).length / Math.sqrt(left.length * right.length);
}

function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const value of a) if (b.has(value)) common += 1;
  return (2 * common) / (a.size + b.size);
}

function chapterIndex(chapters: Chapter[], chapterId?: string): number {
  if (!chapterId) return chapters.length - 1;
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  return index >= 0 ? index : chapters.length - 1;
}

export function isCodexEntryActive(entry: CodexEntry, chapters: Chapter[], chapterId?: string): boolean {
  const current = chapterIndex(chapters, chapterId);
  const start = entry.temporal?.validFromChapterId ? chapterIndex(chapters, entry.temporal.validFromChapterId) : 0;
  const end = entry.temporal?.validToChapterId ? chapterIndex(chapters, entry.temporal.validToChapterId) : Number.POSITIVE_INFINITY;
  return current >= start && current <= end;
}

function excerptAround(text: string, start: number, end: number, radius = 90): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

export function indexCodexMentions(entries: CodexEntry[], chapters: Chapter[]): CodexEntry[] {
  return entries.map((entry) => {
    const terms = [entry.name, ...(entry.aliases || [])]
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .sort((left, right) => right.length - left.length);
    const mentions: CodexMention[] = [];
    for (const chapter of chapters) {
      const normalizedChapter = normalize(chapter.content);
      for (const term of terms) {
        const normalizedTerm = normalize(term);
        if (!normalizedTerm) continue;
        let position = normalizedChapter.indexOf(normalizedTerm);
        while (position >= 0 && mentions.length < 200) {
          // Офсеты совпадают для большинства кириллических нормализаций; excerpt строится по исходному тексту.
          mentions.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            start: position,
            end: position + normalizedTerm.length,
            matchedTerm: term,
            excerpt: excerptAround(chapter.content, position, position + normalizedTerm.length),
          });
          position = normalizedChapter.indexOf(normalizedTerm, position + normalizedTerm.length);
        }
      }
    }
    return { ...entry, mentions };
  });
}

export function retrieveCodexEntries(
  entries: CodexEntry[],
  chapters: Chapter[],
  chapterId: string | undefined,
  query: string,
  limit = 6,
): CodexRetrievalHit[] {
  const queryTokens = tokens(query);
  const queryStems = queryTokens.map(stem).filter(Boolean);
  const activeIndex = chapterIndex(chapters, chapterId);
  return entries
    .filter((entry) => isCodexEntryActive(entry, chapters, chapterId))
    .map((entry) => {
      const searchable = [entry.name, ...(entry.aliases || []), entry.description, ...entry.tags].join(" ");
      const candidateTokens = tokens(searchable);
      const lexical = overlap(queryTokens, candidateTokens);
      const stemmed = overlap(queryStems, candidateTokens.map(stem).filter(Boolean));
      const fuzzy = trigramSimilarity(query, `${entry.name} ${entry.description}`);
      const recentMention = (entry.mentions || []).some((mention) => chapterIndex(chapters, mention.chapterId) >= activeIndex - 1);
      const score = Math.round((lexical * 0.55 + stemmed * 0.3 + fuzzy * 0.15 + (recentMention ? 0.08 : 0)) * 10_000) / 10_000;
      const evidence = lexical > 0.01 ? "совпадение терминов" : stemmed > 0.01 ? "совпадение смысловых основ" : "близость формулировок";
      return {
        entryId: entry.id,
        label: entry.name,
        excerpt: entry.description.replace(/\s+/g, " ").trim().slice(0, 420),
        reason: `${evidence}${recentMention ? "; упомянуто рядом с текущей главой" : ""}`,
        score,
      };
    })
    .filter((hit) => hit.score > 0.02)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "ru"))
    .slice(0, Math.max(1, Math.min(12, limit)));
}

export function buildCodexContext(hits: CodexRetrievalHit[]): string {
  if (!hits.length) return "";
  return hits.map((hit) => `Кодекс: ${hit.label}\n${hit.excerpt}`).join("\n\n");
}
