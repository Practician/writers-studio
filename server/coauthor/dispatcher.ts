import { aiTellScore } from "../humanStyle";
import {
  createAppendChangeset,
  createSelectionChangeset,
  qualityReportFromAiTell,
  type CoauthorPlanStep,
  type CoauthorRun,
} from "../../src/lib/coauthorContracts";
import { DEFAULT_MAX_AI_TELL_SCORE } from "../../src/lib/coauthorQuality";
import { CoauthorRunStore } from "./runStore";

export type CoauthorGenerate = (systemInstruction: string, prompt: string, model: string) => Promise<string>;

function planFor(run: CoauthorRun): CoauthorPlanStep[] {
  const reviewTitle = run.intent === "audit" ? "Проверить риски" : "Проверить результат";
  if (run.mode === "quick") {
    return [{ id: "generate", title: "Подготовить вариант", detail: "Создать один бережный вариант без скрытого применения", status: "pending" }];
  }
  return [
    { id: "context", title: "Проверить контекст", detail: "Учесть выбранный текст, соседнюю главу и канон", status: "pending" },
    { id: "generate", title: "Подготовить вариант", detail: "Сформировать результат согласно цели автора", status: "pending" },
    { id: "review", title: reviewTitle, detail: "Оценить локальные стилевые риски и подготовить безопасную ревизию", status: "pending" },
  ];
}

function buildPrompt(run: CoauthorRun): { system: string; prompt: string; modifiesText: boolean } {
  const input = run.context.input;
  const target = input.selectedText?.trim() || input.baseText;
  const context = [
    input.title ? `Книга: ${input.title}` : "",
    input.genre ? `Жанр: ${input.genre}` : "",
    input.chapterTitle ? `Глава: ${input.chapterTitle}` : "",
    input.chapterSummary ? `Синопсис: ${input.chapterSummary}` : "",
    input.previousChapter ? `Предыдущая глава:\n${input.previousChapter.slice(-8_000)}` : "",
    input.worldBible ? `Библия мира:\n${input.worldBible.slice(0, 8_000)}` : "",
    input.bookPlan ? `План книги:\n${input.bookPlan.slice(0, 5_000)}` : "",
  ].filter(Boolean).join("\n\n");
  const system = [
    "Ты — литературный соавтор. Сохраняй факты, POV и авторский голос.",
    "Не утверждай, что определил авторство текста. Локальные стилевые сигналы — только подсказки для редакторской работы.",
    "Не добавляй пояснений о своих действиях внутри художественного текста.",
  ].join(" ");

  if (run.intent === "brainstorm") {
    return {
      system,
      prompt: `${context}\n\nЦель автора: ${run.goal}\n\nПредложи 5 конкретных сюжетных вариантов с конфликтом, ставкой и последствием. Не меняй рукопись.`,
      modifiesText: false,
    };
  }
  if (run.intent === "plan") {
    return {
      system,
      prompt: `${context}\n\nЦель автора: ${run.goal}\n\nСоставь короткий план следующих сцен: бит, конфликт, действие героя, новое последствие. Не пиши главу и не меняй рукопись.`,
      modifiesText: false,
    };
  }
  if (run.intent === "audit") {
    return {
      system,
      prompt: `${context}\n\nТекст для аудита:\n"""\n${target.slice(0, 12_000)}\n"""\n\nЦель автора: ${run.goal}\n\nВерни редакторский отчёт: риски канона, повторы, места для уточнения и что лучше оставить. Не переписывай текст.`,
      modifiesText: false,
    };
  }

  const action = run.intent === "continue"
    ? "Продолжи текст естественно, не повторяя уже сказанное. Верни только новый фрагмент."
    : "Бережно переработай целевой фрагмент. Сохрани события, факты, имена и POV. Верни только переработанный фрагмент.";
  return {
    system,
    prompt: `${context}\n\nЦель автора: ${run.goal}\n\nЦелевой текст:\n"""\n${target.slice(0, 12_000)}\n"""\n\n${action}`,
    modifiesText: true,
  };
}

export async function executeCoauthorRun(
  store: CoauthorRunStore,
  run: CoauthorRun,
  generate: CoauthorGenerate,
): Promise<CoauthorRun> {
  const plan = planFor(run);
  store.updatePlan(run.id, plan);
  store.setStatus(run.id, run.mode === "quick" ? "running" : "planning", "Соавтор готовит контекст задачи");
  store.addCheckpoint(run.id, "Контекст", "Зафиксированы текст, канон и авторская цель");
  plan[0] && (plan[0].status = "completed");
  store.updatePlan(run.id, plan);

  const built = buildPrompt(run);
  store.setStatus(run.id, "running", "Соавтор готовит вариант");
  store.addCheckpoint(run.id, "Генерация", "Создаётся результат без автоматического применения к рукописи");
  const output = (await generate(built.system, built.prompt, run.options.model)).trim();
  if (!output) throw new Error("Соавтор вернул пустой результат");

  const current = store.get(run.id);
  if (current?.status === "cancelled") return current;

  if (!built.modifiesText) {
    return store.complete(run.id, output) ?? run;
  }

  const aiTell = aiTellScore(output);
  const quality = qualityReportFromAiTell(
    aiTell.score,
    DEFAULT_MAX_AI_TELL_SCORE,
    aiTell.hits.slice(0, 5).map((hit) => `${hit.category}: ${hit.match}`),
  );
  const input = run.context.input;
  const changeset = run.intent === "continue" || !run.context.input.selectedText
    ? createAppendChangeset(input.baseText, `${input.baseText.trim() ? "\n\n" : ""}${output}`, run.goal)
    : run.context.input.selectedText && run.context.input.baseText.indexOf(run.context.input.selectedText) >= 0
      ? createSelectionChangeset(
          input.baseText,
          {
            start: input.baseText.indexOf(run.context.input.selectedText),
            end: input.baseText.indexOf(run.context.input.selectedText) + run.context.input.selectedText.length,
          },
          output,
          run.goal,
        )
      : createAppendChangeset(input.baseText, `${input.baseText.trim() ? "\n\n" : ""}${output}`, run.goal);
  store.addCheckpoint(run.id, "Проверка", quality.risk.label);
  return store.complete(run.id, output, quality, changeset) ?? run;
}
