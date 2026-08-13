import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Languages, Loader2, Save, ShieldCheck } from "lucide-react";
import { checkWithLanguageTool, loadLanguageToolSettings, saveLanguageToolSettings, type LanguageToolMatch } from "../lib/languageTool";

interface LanguageToolPanelProps {
  text: string;
  chapterTitle?: string;
}

export default function LanguageToolPanel({ text, chapterTitle }: LanguageToolPanelProps) {
  const [endpoint, setEndpoint] = useState("");
  const [language, setLanguage] = useState("ru-RU");
  const [matches, setMatches] = useState<LanguageToolMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const settings = loadLanguageToolSettings();
    setEndpoint(settings.endpoint);
    setLanguage(settings.language);
    setMatches([]);
    setStatus("");
  }, [chapterTitle]);

  const saveSettings = () => {
    saveLanguageToolSettings({ endpoint: endpoint.trim(), language });
    setStatus("Настройки сохранены локально в браузере.");
  };

  const check = async () => {
    if (!text.trim()) {
      setStatus("В текущей главе нет текста для проверки.");
      return;
    }
    setLoading(true);
    setStatus("Отправляю текст только в выбранный вами сервис…");
    try {
      const result = await checkWithLanguageTool(text, { endpoint, language });
      setMatches(result);
      setStatus(result.length ? `Найдено замечаний: ${result.length}. Это подсказки, не автоматические правки.` : "Замечаний не найдено.");
    } catch (cause: any) {
      setStatus(cause?.message || "Не удалось выполнить проверку.");
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  return <section className="mt-4 rounded-lg border border-slate-800 bg-slate-950/45 p-3 text-xs text-slate-200"><div className="flex items-start gap-2"><Languages className="mt-0.5 h-4 w-4 text-indigo-300" /><div><p className="font-semibold">Внешняя проверка LanguageTool — по желанию</p><p className="mt-1 leading-relaxed text-slate-400">Подключается только к вашему endpoint. Пока endpoint не указан и кнопка не нажата, текст никуда не отправляется. Предложения не заменяют текст автоматически.</p></div></div><div className="mt-3 space-y-2"><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="Ваш endpoint, например https://languagetool.example" className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100" /><div className="flex gap-2"><select value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded border border-slate-700 bg-slate-900 p-2 text-xs"><option value="ru-RU">Русский</option><option value="en-US">English</option></select><button onClick={saveSettings} className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1.5 hover:bg-slate-800"><Save className="h-3 w-3" />Сохранить</button><button onClick={() => void check()} disabled={loading} className="ml-auto flex items-center gap-1 rounded border border-indigo-800/60 bg-indigo-950/30 px-2 py-1.5 text-indigo-100 hover:bg-indigo-950/50 disabled:opacity-50">{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}Проверить</button></div></div>{status ? <p className="mt-3 text-slate-400">{status}</p> : null}{matches.length ? <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{matches.map((match, index) => <div key={`${match.offset}-${index}`} className="rounded border border-slate-800 bg-slate-900/60 p-2"><p className="font-medium text-slate-200">{match.shortMessage || match.message}</p><p className="mt-1 text-slate-400">{match.message}</p>{match.replacements.length ? <p className="mt-1 text-indigo-200">Варианты: {match.replacements.join(" · ")}</p> : null}</div>)}</div> : null}<a className="mt-3 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300" href="https://languagetool.org/" target="_blank" rel="noreferrer">О сервисе LanguageTool <ExternalLink className="h-3 w-3" /></a></section>;
}
