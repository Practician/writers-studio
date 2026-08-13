import type { Chapter, CodexEntry, ManuscriptAuditIssue, ManuscriptAuditReport, Story } from "../types";

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9]+/giu, " ").replace(/\s+/gu, " ").trim();
}

function words(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function excerpt(value: string, maxLength = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function issue(
  category: ManuscriptAuditIssue["category"],
  severity: ManuscriptAuditIssue["severity"],
  title: string,
  explanation: string,
  recommendation: string,
  chapter?: Chapter,
  extra: Pick<ManuscriptAuditIssue, "excerpt" | "relatedCodexEntryId"> = {},
): ManuscriptAuditIssue {
  return {
    id: `audit-${category}-${chapter?.id || "story"}-${Math.random().toString(36).slice(2, 9)}`,
    category,
    severity,
    title,
    explanation,
    recommendation,
    chapterId: chapter?.id,
    chapterTitle: chapter?.title,
    ...extra,
  };
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function chapterPosition(chapters: Chapter[], chapterId?: string): number {
  if (!chapterId) return -1;
  return chapters.findIndex((chapter) => chapter.id === chapterId);
}

function temporalIssues(story: Story, entries: CodexEntry[]): ManuscriptAuditIssue[] {
  const issues: ManuscriptAuditIssue[] = [];
  for (const entry of entries) {
    const from = entry.temporal?.validFromChapterId ? chapterPosition(story.chapters, entry.temporal.validFromChapterId) : 0;
    const to = entry.temporal?.validToChapterId ? chapterPosition(story.chapters, entry.temporal.validToChapterId) : Number.POSITIVE_INFINITY;
    if (from === 0 && to === Number.POSITIVE_INFINITY) continue;
    const terms = [entry.name, ...(entry.aliases || [])].filter((term) => term.trim().length >= 2);
    if (!terms.length) continue;
    const pattern = new RegExp(terms.map(escaped).join("|"), "iu");
    story.chapters.forEach((chapter, index) => {
      if (index >= from && index <= to || !chapter.content.trim()) return;
      const match = chapter.content.match(pattern);
      if (!match) return;
      const before = index < from;
      issues.push(issue(
        "temporal_canon",
        "warning",
        `Временной конфликт: «${entry.name}»`,
        before
          ? `Запись Codex действует только с более поздней главы, но упомянута здесь как «${match[0]}».`
          : `Запись Codex уже не действует в этой части книги, но упомянута здесь как «${match[0]}».`,
        "Проверьте, является ли это намеренной ретроспективой, и при необходимости уточните диапазон факта или сцену.",
        chapter,
        { excerpt: excerpt(chapter.content.slice(Math.max(0, (match.index || 0) - 90), (match.index || 0) + match[0].length + 120)), relatedCodexEntryId: entry.id },
      ));
    });
  }
  return issues;
}

function duplicateIssues(chapters: Chapter[]): ManuscriptAuditIssue[] {
  const buckets = new Map<string, Array<{ chapter: Chapter; paragraph: string }>>();
  for (const chapter of chapters) {
    for (const paragraph of chapter.content.split(/\n{2,}/u).map((item) => item.trim()).filter((item) => words(item) >= 12)) {
      const key = normalize(paragraph);
      const list = buckets.get(key) || [];
      list.push({ chapter, paragraph });
      buckets.set(key, list);
    }
  }
  const issues: ManuscriptAuditIssue[] = [];
  for (const occurrences of buckets.values()) {
    const uniqueChapters = new Set(occurrences.map((item) => item.chapter.id));
    if (uniqueChapters.size < 2) continue;
    const [first, ...rest] = occurrences;
    for (const duplicate of rest) {
      if (duplicate.chapter.id === first.chapter.id) continue;
      issues.push(issue(
        "duplicate",
        "warning",
        "Повторённый абзац в разных главах",
        `Этот фрагмент уже встречается в «${first.chapter.title}». Повтор может быть намеренным мотивом, но требует решения автора.`,
        "Оставьте повтор как осознанный рефрен или переработайте один из абзацев, сохраняя фактологию.",
        duplicate.chapter,
        { excerpt: excerpt(duplicate.paragraph) },
      ));
    }
  }
  return issues;
}

function structureIssues(chapters: Chapter[]): ManuscriptAuditIssue[] {
  const issues: ManuscriptAuditIssue[] = [];
  for (const chapter of chapters) {
    const count = words(chapter.content);
    if (!chapter.content.trim()) {
      issues.push(issue("structure", "blocking", "Пустая глава", "Глава существует в структуре, но не содержит текста.", "Напишите сцену, перенесите главу или явно пометьте её как плановую.", chapter));
    } else if (count < 80) {
      issues.push(issue("structure", "info", "Очень короткая глава", `В главе около ${count} слов. Это может быть намеренным интерлюдием.`, "Подтвердите, что краткость является художественным решением, либо развейте сцену.", chapter, { excerpt: excerpt(chapter.content) }));
    }
    if (!chapter.summary.trim()) {
      issues.push(issue("structure", "info", "Нет синопсиса главы", "Без краткого синопсиса сложнее собрать точный контекст для генерации и ревизии.", "Добавьте 1–3 предложения: конфликт, изменение состояния и последствие.", chapter));
    }
  }
  return issues;
}

function codexCoverageIssues(story: Story, entries: CodexEntry[]): ManuscriptAuditIssue[] {
  if (!story.chapters.some((chapter) => chapter.content.trim())) return [];
  return entries
    .filter((entry) => !entry.mentions?.length && entry.type !== "lore")
    .map((entry) => issue(
      "codex_coverage",
      "info",
      `Нет индексированных упоминаний: «${entry.name}»`,
      "Запись есть в Codex, но индекс не нашёл её имя или псевдоним в главах.",
      "Если запись должна появляться в книге, проверьте имя и псевдонимы. Иначе отметьте её как плановую в описании.",
      undefined,
      { relatedCodexEntryId: entry.id },
    ));
}

export function auditManuscript(story: Story, entries: CodexEntry[]): ManuscriptAuditReport {
  const indexedEntries = entries.map((entry) => ({ ...entry, mentions: entry.mentions || [] }));
  const issues = [
    ...structureIssues(story.chapters),
    ...duplicateIssues(story.chapters),
    ...temporalIssues(story, indexedEntries),
    ...codexCoverageIssues(story, indexedEntries),
  ].sort((left, right) => {
    const rank = { blocking: 0, warning: 1, info: 2 };
    return rank[left.severity] - rank[right.severity] || left.title.localeCompare(right.title, "ru");
  });
  return {
    storyId: story.id,
    createdAt: Date.now(),
    chapterCount: story.chapters.length,
    wordCount: story.chapters.reduce((sum, chapter) => sum + words(chapter.content), 0),
    issues,
  };
}
