import { useEffect, useState } from "react";
import { Check, MessageSquarePlus, Save, Theater, X } from "lucide-react";
import type { Chapter, SceneComment, ScenePlan, Story } from "../types";

interface SceneBoardPanelProps {
  story: Story;
  activeChapter?: Chapter;
  onSaveScenePlan: (chapterId: string, plan: ScenePlan) => void;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function SceneBoardPanel({ story, activeChapter, onSaveScenePlan }: SceneBoardPanelProps) {
  const [pov, setPov] = useState("");
  const [purpose, setPurpose] = useState("");
  const [conflict, setConflict] = useState("");
  const [turn, setTurn] = useState("");
  const [outcome, setOutcome] = useState("");
  const [comments, setComments] = useState<SceneComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const plan = activeChapter?.scenePlan;
    setPov(plan?.pov || "");
    setPurpose(plan?.purpose || activeChapter?.summary || "");
    setConflict(plan?.conflict || "");
    setTurn(plan?.turn || "");
    setOutcome(plan?.outcome || "");
    setComments(plan?.comments || []);
    setCommentDraft("");
    setSaved(false);
  }, [activeChapter?.id]);

  if (!activeChapter) return <div className="p-4 text-sm text-slate-400">Выберите главу, чтобы спланировать её сцену.</div>;

  const save = () => {
    onSaveScenePlan(activeChapter.id, { pov, purpose, conflict, turn, outcome, comments, updatedAt: Date.now() });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1_600);
  };

  const addComment = () => {
    const text = commentDraft.trim();
    if (!text) return;
    setComments((previous) => [...previous, { id: makeId("scene-comment"), text, createdAt: Date.now(), status: "open" }]);
    setCommentDraft("");
  };

  return <div className="flex h-full flex-col overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-slate-100">
    <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Theater className="h-5 w-5 text-fuchsia-300" />Сценовая доска</h2><p className="mt-1 text-xs text-slate-400">Планирует драматическое движение главы. Сцена не генерируется и рукопись не меняется.</p></div><button onClick={save} className="flex items-center gap-2 rounded-lg bg-fuchsia-700 px-3 py-2 text-xs font-semibold text-white hover:bg-fuchsia-600"><Save className="h-3.5 w-3.5" />{saved ? "Сохранено" : "Сохранить"}</button></div>
    <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-300">Глава: <strong>{activeChapter.title}</strong></p>
    <div className="mt-4 space-y-3">{[
      ["POV и фокус", pov, setPov, "Кто воспринимает сцену и что замечает?"],
      ["Цель сцены", purpose, setPurpose, "Что должно измениться к концу сцены?"],
      ["Конфликт", conflict, setConflict, "Кто или что мешает цели?"],
      ["Поворот", turn, setTurn, "Какая новая информация, выбор или действие меняет ход сцены?"],
      ["Последствие", outcome, setOutcome, "В каком состоянии герой и сюжет выходят из сцены?"],
    ].map(([label, value, setter, placeholder]) => <label key={label as string} className="block"><span className="mb-1 block text-xs font-medium text-slate-300">{label as string}</span><textarea value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} rows={2} placeholder={placeholder as string} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 outline-none focus:border-fuchsia-500" /></label>)}</div>
    <section className="mt-5 border-t border-slate-800 pt-4"><h3 className="text-sm font-semibold">Комментарии к сцене · {comments.filter((comment) => comment.status === "open").length} открыто</h3><div className="mt-3 flex gap-2"><textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} rows={2} placeholder="Например: проверить мотив ключа перед поворотом" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200" /><button onClick={addComment} className="self-start rounded-lg border border-fuchsia-800/70 p-2 text-fuchsia-200 hover:bg-fuchsia-950/30" title="Добавить комментарий"><MessageSquarePlus className="h-4 w-4" /></button></div><div className="mt-3 space-y-2">{comments.map((comment) => <div key={comment.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-xs"><span className={comment.status === "resolved" ? "text-slate-500 line-through" : "text-slate-200"}>{comment.text}</span><div className="flex gap-1"><button onClick={() => setComments((previous) => previous.map((item) => item.id === comment.id ? { ...item, status: item.status === "open" ? "resolved" : "open" } : item))} className="rounded p-1 text-emerald-300 hover:bg-emerald-950/30" title="Переключить статус"><Check className="h-3.5 w-3.5" /></button><button onClick={() => setComments((previous) => previous.filter((item) => item.id !== comment.id))} className="rounded p-1 text-rose-300 hover:bg-rose-950/30" title="Удалить"><X className="h-3.5 w-3.5" /></button></div></div>)}</div></section>
    <p className="mt-5 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-400">Сохранённая доска становится явной опорой для вас; перед запуском генерации перенесите цель и конфликт в синопсис главы или задачу Соавтора.</p>
  </div>;
}
