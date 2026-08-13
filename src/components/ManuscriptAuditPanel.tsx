import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, FileSearch, Loader2, Play, ShieldAlert, XCircle } from "lucide-react";
import type { ManuscriptAuditIssue, ManuscriptAuditReport, ReviewTask, Story } from "../types";
import { listCodexEntries, listReviewTasks, saveCodexEntry, saveReviewTask } from "../lib/authorStorage";
import { indexCodexMentions } from "../lib/codexRetrieval";
import { auditManuscript } from "../lib/manuscriptAudit";

interface ManuscriptAuditPanelProps {
  story: Story;
  onOpenChapter: (chapterId: string) => void;
}

const severityStyle = {
  blocking: "border-rose-900/60 bg-rose-950/25 text-rose-100",
  warning: "border-amber-900/60 bg-amber-950/20 text-amber-100",
  info: "border-sky-900/60 bg-sky-950/20 text-sky-100",
};

const statusLabel: Record<ReviewTask["status"], string> = {
  open: "Открыта",
  acknowledged: "В работе",
  resolved: "Решена",
  dismissed: "Не требуется",
};

function taskKey(issue: ManuscriptAuditIssue): string {
  return `${issue.category}:${issue.chapterId || "story"}:${issue.relatedCodexEntryId || ""}:${issue.title}`;
}

export default function ManuscriptAuditPanel({ story, onOpenChapter }: ManuscriptAuditPanelProps) {
  const [report, setReport] = useState<ManuscriptAuditReport | null>(null);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const loadTasks = async () => setTasks(await listReviewTasks(story.id));

  useEffect(() => {
    setReport(null);
    setError("");
    void loadTasks().catch(() => setTasks([]));
  }, [story.id]);

  const runAudit = async () => {
    setRunning(true);
    setError("");
    try {
      const entries = await listCodexEntries(story.id);
      const indexedEntries = indexCodexMentions(entries, story.chapters);
      await Promise.all(indexedEntries.map((entry) => saveCodexEntry({ ...entry, updatedAt: Date.now() })));
      setReport(auditManuscript(story, indexedEntries));
      await loadTasks();
    } catch (cause: any) {
      setError(cause?.message || "Не удалось завершить аудит рукописи");
    } finally {
      setRunning(false);
    }
  };

  const knownKeys = useMemo(() => new Set(tasks.map((task) => taskKey(task.issue))), [tasks]);

  const createTask = async (issue: ManuscriptAuditIssue) => {
    const now = Date.now();
    const task: ReviewTask = {
      id: `review-${now}-${Math.random().toString(36).slice(2, 8)}`,
      storyId: story.id,
      issue,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await saveReviewTask(task);
    setTasks((previous) => [task, ...previous]);
  };

  const updateTask = async (task: ReviewTask, status: ReviewTask["status"]) => {
    const updated = { ...task, status, updatedAt: Date.now() };
    await saveReviewTask(updated);
    setTasks((previous) => previous.map((item) => item.id === task.id ? updated : item));
  };

  const counts = report?.issues.reduce((all, issue) => ({ ...all, [issue.severity]: (all[issue.severity] || 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><FileSearch className="h-5 w-5 text-cyan-300" />Аудит рукописи</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Проверяет структуру, повторы и temporal-канон. Ничего не переписывает и не применяет автоматически.</p></div>
        <button onClick={() => void runAudit()} disabled={running} className="flex shrink-0 items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-600 disabled:opacity-50">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? "Проверка…" : "Запустить"}</button>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-200">{error}</div> : null}

      {report ? <div className="mt-5 space-y-4"><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"><span className="text-slate-400">Объём</span><p className="mt-1 text-lg font-semibold">{report.wordCount.toLocaleString("ru-RU")} слов</p><p className="text-slate-500">{report.chapterCount} глав</p></div><div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"><span className="text-slate-400">Замечания</span><p className="mt-1 text-lg font-semibold">{report.issues.length}</p><p className="text-slate-500">{counts?.blocking || 0} блокирующих · {counts?.warning || 0} предупреждений</p></div></div>
        {report.issues.length === 0 ? <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4 text-sm text-emerald-200"><CheckCircle2 className="mr-2 inline h-4 w-4" />Детерминированных конфликтов не найдено. Это не заменяет авторскую редактуру, но базовые инварианты пройдены.</div> : report.issues.map((issue) => <article key={issue.id} className={`rounded-lg border p-3 text-xs ${severityStyle[issue.severity]}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{issue.title}</p><p className="mt-1 leading-relaxed opacity-85">{issue.explanation}</p></div><span className="rounded bg-black/15 px-2 py-1 text-[10px] uppercase">{issue.severity}</span></div>{issue.excerpt ? <blockquote className="mt-2 border-l-2 border-current/30 pl-2 italic opacity-80">{issue.excerpt}</blockquote> : null}<p className="mt-2 text-slate-300"><strong>Следующий шаг:</strong> {issue.recommendation}</p><div className="mt-3 flex gap-2">{issue.chapterId ? <button onClick={() => onOpenChapter(issue.chapterId!)} className="rounded border border-white/15 px-2 py-1 text-[11px] hover:bg-white/10">Открыть главу</button> : null}{!knownKeys.has(taskKey(issue)) ? <button onClick={() => void createTask(issue)} className="rounded border border-white/15 px-2 py-1 text-[11px] hover:bg-white/10">Создать review-задачу</button> : <span className="rounded border border-emerald-900/60 px-2 py-1 text-[11px] text-emerald-200">Задача уже создана</span>}</div></article>)}</div> : <div className="mt-8 rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400"><ShieldAlert className="mx-auto mb-2 h-6 w-6 text-cyan-300" />Запустите аудит, чтобы получить список проверяемых автором рисков.</div>}

      <div className="mt-6 border-t border-slate-800 pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-4 w-4 text-cyan-300" />Review-задачи · {tasks.length}</h3><div className="mt-3 space-y-2">{tasks.length ? tasks.map((task) => <div key={task.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs"><div className="flex items-start justify-between gap-2"><div><p className="font-medium text-slate-200">{task.issue.title}</p><p className="mt-1 text-slate-500">{task.issue.chapterTitle || "Вся рукопись"}</p></div><span className="text-slate-400">{statusLabel[task.status]}</span></div><div className="mt-2 flex gap-2">{task.status === "open" ? <button onClick={() => void updateTask(task, "acknowledged")} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">В работу</button> : null}{task.status !== "resolved" ? <button onClick={() => void updateTask(task, "resolved")} className="rounded border border-emerald-900/60 px-2 py-1 text-emerald-200 hover:bg-emerald-950/30">Решено</button> : null}{task.status !== "dismissed" ? <button onClick={() => void updateTask(task, "dismissed")} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"><XCircle className="mr-1 inline h-3 w-3" />Не требуется</button> : null}</div></div>) : <p className="text-xs text-slate-500">Созданные из замечаний задачи появятся здесь.</p>}</div></div>
    </div>
  );
}
