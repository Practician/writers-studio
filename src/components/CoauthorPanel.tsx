import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, FileText, Lightbulb, Play, ShieldCheck, Square, Sparkles, Wand2 } from "lucide-react";
import type { Chapter, Story, TextSelection } from "../types";
import { listCodexEntries, loadAuthorProfile } from "../lib/authorStorage";
import { buildCodexContext, indexCodexMentions, retrieveCodexEntries } from "../lib/codexRetrieval";
import { authorCorpusRevision, loadOrBuildDeepStyleProfile } from "../lib/authorVoiceProfile";
import { applyChangeset, revisionOf, type CoauthorIntent, type CoauthorMode, type CoauthorRun } from "../lib/coauthorContracts";

interface CoauthorPanelProps {
  story: Story;
  currentDraft: string;
  selectedText: string;
  textSelection: TextSelection | null;
  activeChapter?: Chapter;
  selectedModel: string;
  llmProvider: string;
  llmApiFields: Record<string, unknown>;
  onInsertText: (text: string, actionType: "append" | "replace") => void;
}

const INTENTS: Array<{ id: CoauthorIntent; label: string; hint: string }> = [
  { id: "continue", label: "Продолжить", hint: "Добавит новый фрагмент после текущего текста." },
  { id: "improve", label: "Улучшить", hint: "Бережно переработает выделение или текущую сцену." },
  { id: "rewrite", label: "Переписать", hint: "Подготовит альтернативный вариант с сохранением канона." },
  { id: "brainstorm", label: "Идеи", hint: "Предложит варианты без изменения рукописи." },
  { id: "plan", label: "План", hint: "Составит план сцен без изменения рукописи." },
  { id: "audit", label: "Аудит", hint: "Покажет риски и то, что лучше оставить." },
];

const MODES: Array<{ id: CoauthorMode; label: string }> = [
  { id: "quick", label: "Быстро" },
  { id: "guided", label: "С планом" },
  { id: "autonomous", label: "Автономно" },
];

export default function CoauthorPanel({
  story,
  currentDraft,
  selectedText,
  textSelection,
  activeChapter,
  selectedModel,
  llmProvider,
  llmApiFields,
  onInsertText,
}: CoauthorPanelProps) {
  const [intent, setIntent] = useState<CoauthorIntent>("improve");
  const [mode, setMode] = useState<CoauthorMode>("quick");
  const [goal, setGoal] = useState("Сделай текст естественнее, сохранив факты, голос и POV.");
  const [run, setRun] = useState<CoauthorRun | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [voicePreview, setVoicePreview] = useState<{ authorVoiceAvailable: boolean; note: string; withAuthorVoice: { sourceCount: number; manifest: Array<{ id: string; label: string }>; instructionPreview: string } | null; withoutAuthorVoice: { sourceCount: number; manifest: Array<{ id: string; label: string }>; instructionPreview: string } } | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const activeIntent = useMemo(() => INTENTS.find((item) => item.id === intent) ?? INTENTS[1], [intent]);
  const hasSelection = Boolean(selectedText.trim() && textSelection && textSelection.chapterId === activeChapter?.id);

  useEffect(() => () => sourceRef.current?.close(), []);

  const previousChapter = useMemo(() => {
    if (!activeChapter) return "";
    const currentIndex = story.chapters.findIndex((chapter) => chapter.id === activeChapter.id);
    return currentIndex > 0 ? story.chapters[currentIndex - 1]?.content || "" : "";
  }, [activeChapter, story.chapters]);

  const sceneBrief = useMemo(() => {
    if (!activeChapter) return "";
    const plan = activeChapter.scenePlan;
    if (!plan) return activeChapter.summary || "";
    return [
      activeChapter.summary,
      `Сценовая доска — POV: ${plan.pov}; цель: ${plan.purpose}; конфликт: ${plan.conflict}; поворот: ${plan.turn}; последствие: ${plan.outcome}`,
    ].filter(Boolean).join("\n");
  }, [activeChapter]);

  const connectStream = (runId: string) => {
    sourceRef.current?.close();
    const source = new EventSource(`/api/coauthor/runs/${runId}/stream`);
    sourceRef.current = source;
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") {
        setMessages((previous) => [...previous, payload.message]);
        if (["awaiting_approval", "completed", "cancelled", "failed"].includes(payload.status)) {
          source.close();
          setLoading(false);
          fetch(`/api/coauthor/runs/${runId}`).then((response) => response.ok ? response.json() : null).then((next) => next && setRun(next));
        }
      }
      if (payload.type === "checkpoint") setMessages((previous) => [...previous, `${payload.title}: ${payload.message}`]);
      if (payload.type === "changeset_ready") {
        setRun((previous) => previous ? { ...previous, changeset: payload.changeset, quality: payload.quality, status: "awaiting_approval" } : previous);
      }
    };
    source.onerror = () => source.close();
  };

  const buildCodexRetrieval = async () => {
    try {
      const entries = await listCodexEntries(story.id);
      const indexed = indexCodexMentions(entries, story.chapters);
      const query = [goal, activeChapter?.title || "", activeChapter?.summary || "", currentDraft.slice(-4_000)].filter(Boolean).join("\n");
      const codexHits = retrieveCodexEntries(indexed, story.chapters, activeChapter?.id, query);
      return { codexHits, codexContext: buildCodexContext(codexHits) };
    } catch (cause) {
      console.warn("Codex retrieval is unavailable for this run", cause);
      return { codexHits: [], codexContext: "" };
    }
  };

  const previewAuthorVoice = async () => {
    setError(null);
    setPreviewLoading(true);
    try {
      const profile = await loadAuthorProfile(story.id).catch(() => null);
      if (!profile) throw new Error("Сначала создайте и сохраните паспорт автора во вкладке «Автор».");
      const styleProfile = await loadOrBuildDeepStyleProfile(profile, selectedModel, llmProvider, llmApiFields);
      const codex = await buildCodexRetrieval();
      const response = await fetch("/api/coauthor/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          goal,
          target: { storyId: story.id, chapterId: activeChapter?.id },
          input: {
            title: story.title,
            genre: story.genre,
            description: story.description,
            chapterTitle: activeChapter?.title || "",
            chapterSummary: sceneBrief,
            baseText: currentDraft,
            selectedText: hasSelection ? selectedText : "",
            previousChapter,
            worldBible: story.worldBible || story.worldRules?.map((rule) => `[${rule.title}]: ${rule.content}`).join("\n\n") || "",
            bookPlan: story.bookPlan || "",
            codexContext: codex.codexContext,
            codexHits: codex.codexHits,
            authorSample: profile.sample,
            voiceSheet: profile.voiceSheet,
            authorRules: profile.authorRules,
            styleProfile,
          },
          options: { model: selectedModel, authorVoice: { enabled: true, profileRevision: authorCorpusRevision(profile) } },
          llmProvider,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось построить предпросмотр");
      setVoicePreview(data);
    } catch (cause: any) {
      setError(cause.message || "Не удалось построить предпросмотр");
    } finally {
      setPreviewLoading(false);
    }
  };

  const start = async () => {
    setError(null);
    setMessages([]);
    setRun(null);
    setLoading(true);
    try {
      const profile = await loadAuthorProfile(story.id).catch(() => null);
      if (!profile) throw new Error("Сначала создайте и сохраните паспорт автора во вкладке «Автор».");
      const styleProfile = await loadOrBuildDeepStyleProfile(profile, selectedModel, llmProvider, llmApiFields);
      const codex = await buildCodexRetrieval();
      const response = await fetch("/api/coauthor/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          intent,
          goal,
          target: {
            storyId: story.id,
            chapterId: activeChapter?.id,
            baseRevision: revisionOf(currentDraft),
          },
          input: {
            title: story.title,
            genre: story.genre,
            description: story.description,
            chapterTitle: activeChapter?.title || "",
            chapterSummary: sceneBrief,
            baseText: currentDraft,
            selectedText: hasSelection ? selectedText : "",
            previousChapter,
            worldBible: story.worldBible || story.worldRules?.map((rule) => `[${rule.title}]: ${rule.content}`).join("\n\n") || "",
            bookPlan: story.bookPlan || "",
            codexContext: codex.codexContext,
            codexHits: codex.codexHits,
            authorSample: profile.sample,
            voiceSheet: profile.voiceSheet,
            authorRules: profile.authorRules,
            styleProfile,
          },
          options: {
            humanizeDepth: "balanced",
            model: selectedModel,
            authorVoice: { enabled: true, profileRevision: authorCorpusRevision(profile) },
          },
          llmProvider,
          apiKeys: llmApiFields,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось запустить Соавтора");
      setRun(data);
      connectStream(data.id);
    } catch (cause: any) {
      setError(cause.message || "Не удалось запустить Соавтора");
      setLoading(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    await fetch(`/api/coauthor/runs/${run.id}/cancel`, { method: "POST" });
    sourceRef.current?.close();
    setLoading(false);
    setRun((previous) => previous ? { ...previous, status: "cancelled" } : previous);
  };

  const sendFeedback = async (decision: "accepted" | "rejected" | "edited") => {
    if (!run) return;
    const response = await fetch(`/api/coauthor/runs/${run.id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (response.ok) setRun(await response.json());
  };

  const apply = () => {
    if (!run?.changeset) return;
    const result = applyChangeset(currentDraft, run.changeset);
    if (!result.applied) {
      setError("Рукопись изменилась после запуска. Изменения не применены автоматически: сравните результат перед переносом.");
      return;
    }
    onInsertText(result.text, "replace");
    void sendFeedback("accepted");
    setRun((previous) => previous ? { ...previous, status: "completed" } : previous);
    setMessages((previous) => [...previous, "Изменения применены автором."]);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-slate-100">
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/15 p-2 text-violet-300"><Sparkles className="h-5 w-5" /></div>
        <div><h2 className="text-lg font-semibold">Соавтор</h2><p className="text-xs text-slate-400">Один инструмент для быстрых правок, планов и автономных задач.</p></div>
      </div>

      <div className="space-y-4">
        <div><label className="mb-1 block text-xs font-medium text-slate-400">Задача</label><div className="grid grid-cols-2 gap-2">{INTENTS.map((item) => <button key={item.id} onClick={() => setIntent(item.id)} disabled={loading} className={`rounded-lg border px-2 py-2 text-left text-xs ${intent === item.id ? "border-violet-500/50 bg-violet-500/20 text-violet-100" : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800"}`}><span className="block font-medium">{item.label}</span><span className="mt-1 block text-[10px] leading-snug opacity-75">{item.hint}</span></button>)}</div></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-400">Степень самостоятельности</label><div className="flex overflow-hidden rounded-lg border border-slate-700">{MODES.map((item) => <button key={item.id} onClick={() => setMode(item.id)} disabled={loading} className={`flex-1 py-2 text-xs ${mode === item.id ? "bg-violet-600 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800"}`}>{item.label}</button>)}</div><p className="mt-1 text-[10px] text-slate-500">{mode === "quick" ? "Один вариант для локальной задачи." : mode === "guided" ? "Контекст, вариант и проверка в одном запуске." : "Полный проход с журналом контрольных точек."}</p></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-400">Цель автора</label><textarea value={goal} onChange={(event) => setGoal(event.target.value)} disabled={loading} className="min-h-20 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm outline-none focus:border-violet-500" /></div>
        <div className="rounded-lg border border-violet-700/50 bg-violet-950/20 p-2 text-xs text-violet-100"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />Режим авторского голоса включён: Соавтор требует сохранённый паспорт, проверяет сходство с образцом и не применяет текст автоматически.</div>
        <button onClick={() => void previewAuthorVoice()} disabled={loading || previewLoading} className="w-full rounded-lg border border-violet-700/60 bg-violet-950/20 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-950/40 disabled:opacity-50">{previewLoading ? "Готовлю A/B-предпросмотр…" : "Сравнить контекст: с голосом / без голоса"}</button>
        {voicePreview && <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300"><p className="font-medium text-violet-200">A/B-предпросмотр</p><p className="text-slate-400">{voicePreview.note}</p><div className="grid grid-cols-2 gap-2"><div className="rounded border border-slate-800 p-2"><p className="font-medium">Без голоса · {voicePreview.withoutAuthorVoice.sourceCount}</p><p className="mt-1 text-slate-500">{voicePreview.withoutAuthorVoice.manifest.map((item) => item.label).join(" · ") || "Контекст главы"}</p></div><div className="rounded border border-violet-800/60 bg-violet-950/20 p-2"><p className="font-medium text-violet-100">С голосом · {voicePreview.withAuthorVoice?.sourceCount ?? "—"}</p><p className="mt-1 text-violet-200/70">{voicePreview.withAuthorVoice?.manifest.map((item) => item.label).join(" · ") || "Сначала сохраните паспорт"}</p></div></div></div>}
        <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-2 text-xs text-slate-400"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />{hasSelection ? "Будет подготовлена замена выделения; исходная ревизия защищена." : activeIntent.id === "continue" ? "Будет подготовлено продолжение; оно не попадёт в рукопись без подтверждения." : "Будет использована текущая глава; изменения не применяются автоматически."}</div>
        {!loading ? <button onClick={start} className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-500"><Play className="h-4 w-4" />Запустить Соавтора</button> : <button onClick={cancel} className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-900/50 bg-slate-800 px-4 py-3 text-sm font-medium text-rose-300"><Square className="h-4 w-4" />Остановить</button>}
        {error && <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}
      </div>

      {(run || messages.length > 0) && <div className="mt-5 space-y-3 border-t border-slate-800 pt-4"><div className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4 text-violet-400" />Процесс {run ? `· ${run.status}` : ""}</div><div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs text-slate-400">{messages.length ? messages.map((message, index) => <p key={`${message}-${index}`}>{message}</p>) : <p>Ожидание событий…</p>}</div></div>}

      {run?.context.contextManifest?.length ? <details className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300"><summary className="cursor-pointer font-medium text-violet-200">Что учтено в этом запуске · {run.context.contextManifest.length} источников</summary><div className="mt-3 space-y-2">{run.context.contextManifest.map((item) => <div key={item.id} className="rounded-md border border-slate-800 bg-slate-900/70 p-2"><div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-100">{item.label}</span><span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">{item.tokenEstimate} ток.</span></div><p className="mt-1 text-slate-400">{item.reason}</p><p className="mt-1 text-slate-500">{item.excerpt}</p></div>)}</div></details> : null}

      {run?.output && <div className="mt-5 space-y-3 border-t border-slate-800 pt-4"><div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-violet-400" />Результат</div>{run.quality && <div className={`rounded-lg border p-2 text-xs ${run.quality.risk.passed ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-200" : "border-yellow-900/50 bg-yellow-950/20 text-yellow-200"}`}>{run.quality.risk.label}: {run.quality.risk.riskScore}/{run.quality.risk.maxRiskScore}</div>}{run.quality?.signals.filter((signal) => signal.axis === "voice_match").map((signal) => <div key={signal.axis} className={`rounded-lg border p-2 text-xs ${signal.status === "pass" ? "border-violet-700/50 bg-violet-950/20 text-violet-100" : signal.status === "watch" ? "border-yellow-900/50 bg-yellow-950/20 text-yellow-100" : "border-rose-900/50 bg-rose-950/20 text-rose-100"}`}><span className="font-medium">Авторский голос.</span> {signal.summary}{signal.evidence?.length ? <span className="mt-1 block opacity-80">Слабые оси: {signal.evidence.join("; ")}</span> : null}</div>)}<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 font-serif text-sm leading-relaxed text-slate-300">{run.output}</pre>{run.changeset ? <div className="space-y-2"><button onClick={apply} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"><Check className="h-4 w-4" />Применить изменения</button><div className="flex gap-2"><button onClick={() => void sendFeedback("edited")} className="flex-1 rounded-lg border border-slate-700 py-2 text-xs text-slate-300 hover:bg-slate-800">Приму с правками</button><button onClick={() => void sendFeedback("rejected")} className="flex-1 rounded-lg border border-slate-700 py-2 text-xs text-slate-300 hover:bg-slate-800">Отклонить</button></div></div> : <div className="space-y-2"><div className="flex items-center gap-2 text-xs text-slate-400"><Lightbulb className="h-4 w-4 text-amber-400" />Это информационный результат и не меняет рукопись.</div><button onClick={() => void sendFeedback("accepted")} className="w-full rounded-lg border border-slate-700 py-2 text-xs text-slate-300 hover:bg-slate-800">Полезно</button></div>}</div>}
    </div>
  );
}
