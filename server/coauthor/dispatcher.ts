import { aiTellScore } from "../humanStyle";
import { selectStyleExcerpts } from "../authorPipeline";
import { compareStyle } from "../../src/lib/authorAudit";
import {
  createAppendChangeset,
  createSelectionChangeset,
  qualityReportFromAiTell,
  type CoauthorPlanStep,
  type CoauthorRun,
  type ContextManifestItem,
} from "../../src/lib/coauthorContracts";
import { DEFAULT_MAX_AI_TELL_SCORE } from "../../src/lib/coauthorQuality";
import { CoauthorRunStore } from "./runStore";
import { assembleCoauthorContext } from "./contextAssembler";

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

function authorVoicePromptBlock(run: CoauthorRun, target: string): string {
  if (!run.options.authorVoice?.enabled) return "";
  const input = run.context.input;
  const sample = input.authorSample?.trim() || "";
  if (sample.length < 300 || !input.voiceSheet) {
    throw new Error("Авторский режим требует сохранённый паспорт и образец не короче 300 знаков.");
  }
  const excerpts = selectStyleExcerpts(sample.slice(0, 50_000), target).slice(0, 8_000);
  const passport = JSON.stringify(input.voiceSheet).slice(0, 8_000);
  const deepProfile = input.styleProfile ? JSON.stringify(input.styleProfile).slice(0, 8_000) : "не построен";
  return `\n\nПАСПОРТ АВТОРСКОГО ГОЛОСА (обязательное ограничение):\n${passport}\n\nГЛУБОКИЙ ПРОФИЛЬ (метрики, паттерны и эталоны; используй как диапазоны, не как квоты):\n${deepProfile}\n\nЭТАЛОНЫ АВТОРСКОЙ МАНЕРЫ (бери только ритм, интонацию и лексику; не переноси события):\n"""\n${excerpts}\n"""\n\nСохраняй индивидуальные неровности и конкретность автора. Не добавляй искусственные ошибки, разговорные частицы или пунктуацию ради числового сходства.`;
}

function authorRulesPromptBlock(run: CoauthorRun): string {
  const rules = run.context.input.authorRules;
  if (!rules) return "";
  const must = rules.must.map((rule) => `- ОБЯЗАТЕЛЬНО: ${rule}`).join("\n");
  const avoid = rules.avoid.map((rule) => `- НЕ ИСПОЛЬЗОВАТЬ: ${rule}`).join("\n");
  const preferences = rules.preferences.map((rule) => `- ПРЕДПОЧТИТЕЛЬНО: ${rule}`).join("\n");
  const body = [must, avoid, preferences].filter(Boolean).join("\n");
  return body ? `\n\nЯВНЫЕ ПРАВИЛА АВТОРА (они важнее статистического сходства):\n${body}` : "";
}

export function buildCoauthorPrompt(run: CoauthorRun): { system: string; prompt: string; modifiesText: boolean; manifest: ContextManifestItem[] } {
  const input = run.context.input;
  const target = input.selectedText?.trim() || input.baseText;
  const assembled = assembleCoauthorContext(input);
  const context = assembled.text;
  const voiceBlock = authorVoicePromptBlock(run, target);
  const rulesBlock = authorRulesPromptBlock(run);
  const manifest: ContextManifestItem[] = [...assembled.manifest];
  if (voiceBlock.trim()) {
    manifest.push({
      id: "context-author-voice",
      sourceType: "author_voice",
      label: "Паспорт авторского голоса",
      reason: "Авторский режим требует подтверждённый паспорт, глубокий профиль и эталоны манеры",
      relevance: "required",
      inclusionPolicy: "always",
      tokenEstimate: Math.ceil(voiceBlock.length / 4),
      excerpt: "Паспорт, глубокий профиль и отобранные эталоны автора",
      status: "included",
    });
  }
  if (rulesBlock.trim()) {
    manifest.push({
      id: "context-author-rules",
      sourceType: "author_rule",
      label: "Явные правила автора",
      reason: "Правила автора имеют приоритет над статистическим стилевым сходством",
      relevance: "required",
      inclusionPolicy: "always",
      tokenEstimate: Math.ceil(rulesBlock.length / 4),
      excerpt: rulesBlock.replace(/\s+/g, " ").trim().slice(0, 360),
      status: "included",
    });
  }
  const system = [
    "Ты — литературный соавтор. Сохраняй факты, POV и авторский голос.",
    "Не утверждай, что определил авторство текста. Локальные стилевые сигналы — только подсказки для редакторской работы.",
    "Не добавляй пояснений о своих действиях внутри художественного текста.",
  ].join(" ");

  if (run.intent === "brainstorm") {
    return {
      system,
      prompt: `${context}${voiceBlock}${rulesBlock}\n\nЦель автора: ${run.goal}\n\nПредложи 5 конкретных сюжетных вариантов с конфликтом, ставкой и последствием. Не меняй рукопись.`,
      modifiesText: false,
      manifest,
    };
  }
  if (run.intent === "plan") {
    return {
      system,
      prompt: `${context}${voiceBlock}${rulesBlock}\n\nЦель автора: ${run.goal}\n\nСоставь короткий план следующих сцен: бит, конфликт, действие героя, новое последствие. Не пиши главу и не меняй рукопись.`,
      modifiesText: false,
      manifest,
    };
  }
  if (run.intent === "audit") {
    return {
      system,
      prompt: `${context}${voiceBlock}\n\nТекст для аудита:\n"""\n${target.slice(0, 12_000)}\n"""\n\nЦель автора: ${run.goal}\n\nВерни редакторский отчёт: риски канона, повторы, места для уточнения и что лучше оставить. Не переписывай текст.`,
      modifiesText: false,
      manifest,
    };
  }

  const action = run.intent === "continue"
    ? "Продолжи текст естественно, не повторяя уже сказанное. Верни только новый фрагмент."
    : "Бережно переработай целевой фрагмент. Сохрани события, факты, имена и POV. Верни только переработанный фрагмент.";
  return {
    system,
    prompt: `${context}${voiceBlock}${rulesBlock}\n\nЦель автора: ${run.goal}\n\nЦелевой текст:\n"""\n${target.slice(0, 12_000)}\n"""\n\n${action}`,
    modifiesText: true,
    manifest,
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
  const built = buildCoauthorPrompt(run);
  store.setContextManifest(run.id, built.manifest);
  store.addCheckpoint(run.id, "Контекст", `Зафиксированы текст, канон, авторская цель и ${built.manifest.length} источников контекста`);
  plan[0] && (plan[0].status = "completed");
  store.updatePlan(run.id, plan);

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
  if (run.options.authorVoice?.enabled && input.authorSample?.trim().length) {
    const voice = compareStyle(input.authorSample, output);
    quality.signals.push({
      axis: "voice_match",
      status: voice.similarity >= 75 ? "pass" : voice.similarity >= 60 ? "watch" : "fail",
      summary: `Сходство с подтверждённым авторским образцом: ${voice.similarity}/100`,
      evidence: voice.weakestMetrics.map((metric) => `${metric}: ${voice.metricScores[metric]}/100`),
    });
  } else {
    quality.signals.push({ axis: "voice_match", status: "unavailable", summary: "Авторский образец не подключён к этому запуску" });
  }
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
