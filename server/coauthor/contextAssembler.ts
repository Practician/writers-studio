import type {
  CoauthorRunInput,
  ContextManifestItem,
  ContextManifestItemSource,
} from "../../src/lib/coauthorContracts";

export interface CoauthorContextAssembly {
  text: string;
  manifest: ContextManifestItem[];
}

function compactExcerpt(value: string, maxLength = 360): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function estimatedTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function item(
  sourceType: ContextManifestItemSource,
  label: string,
  content: string,
  reason: string,
  options: Partial<Pick<ContextManifestItem, "sourceId" | "revisionId" | "relevance" | "inclusionPolicy">> = {},
): ContextManifestItem | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return {
    id: `context-${sourceType}-${label.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "") || "item"}`,
    sourceType,
    sourceId: options.sourceId,
    revisionId: options.revisionId,
    label,
    reason,
    relevance: options.relevance ?? "supporting",
    inclusionPolicy: options.inclusionPolicy ?? "detected",
    tokenEstimate: estimatedTokens(trimmed),
    excerpt: compactExcerpt(trimmed),
    status: "included",
  };
}

/**
 * Собирает только текущий контекст книги и одновременно создаёт его объяснимый снимок.
 * Голос автора добавляется диспетчером отдельно, потому что там проверяется обязательный паспорт.
 */
export function assembleCoauthorContext(input: CoauthorRunInput): CoauthorContextAssembly {
  const candidates: Array<{ prefix: string; manifest: ContextManifestItem | null; value: string }> = [
    {
      prefix: "Книга",
      value: input.title || "",
      manifest: item("story", "Книга", input.title || "", "Идентифицирует произведение для этого запуска", {
        sourceId: input.title || undefined,
        relevance: "required",
        inclusionPolicy: "always",
      }),
    },
    {
      prefix: "Жанр",
      value: input.genre || "",
      manifest: item("story", "Жанр", input.genre || "", "Задаёт литературные ожидания без навязывания шаблонов", {
        relevance: "supporting",
        inclusionPolicy: "always",
      }),
    },
    {
      prefix: "Глава",
      value: input.chapterTitle || "",
      manifest: item("chapter", "Глава", input.chapterTitle || "", "Связывает результат с текущей главой", {
        sourceId: input.chapterTitle || undefined,
        relevance: "required",
        inclusionPolicy: "always",
      }),
    },
    {
      prefix: "Синопсис",
      value: input.chapterSummary || "",
      manifest: item("chapter", "Синопсис главы", input.chapterSummary || "", "Удерживает задачу текущей главы", {
        relevance: "required",
      }),
    },
    {
      prefix: "Предыдущая глава",
      value: (input.previousChapter || "").slice(-8_000),
      manifest: item("previous_chapter", "Предыдущая глава", (input.previousChapter || "").slice(-8_000), "Поддерживает непрерывность перехода между главами", {
        relevance: "supporting",
      }),
    },
    {
      prefix: "Библия мира",
      value: (input.worldBible || "").slice(0, 8_000),
      manifest: item("world_bible", "Библия мира", (input.worldBible || "").slice(0, 8_000), "Сохраняет правила мира и утверждённые факты", {
        relevance: "required",
      }),
    },
    {
      prefix: "План книги",
      value: (input.bookPlan || "").slice(0, 5_000),
      manifest: item("book_plan", "План книги", (input.bookPlan || "").slice(0, 5_000), "Соотносит сцену с более крупной сюжетной дугой", {
        relevance: "supporting",
      }),
    },
    {
      prefix: "Релевантный кодекс",
      value: (input.codexContext || "").slice(0, 6_000),
      manifest: null,
    },
  ];

  const manifest = [
    ...candidates.flatMap((candidate) => candidate.manifest ? [candidate.manifest] : []),
    ...(input.codexHits || []).map((hit) => ({
      id: `context-codex-${hit.entryId}`,
      sourceType: "codex" as const,
      sourceId: hit.entryId,
      label: `Кодекс: ${hit.label}`,
      reason: hit.reason,
      relevance: hit.score >= 0.2 ? "required" as const : "supporting" as const,
      inclusionPolicy: "detected" as const,
      tokenEstimate: estimatedTokens(hit.excerpt),
      excerpt: compactExcerpt(hit.excerpt),
      status: "included" as const,
    })),
  ];
  const text = candidates
    .filter((candidate) => candidate.value.trim())
    .map((candidate) => `${candidate.prefix}: ${candidate.value}`)
    .join("\n\n");
  return { text, manifest };
}
