import React, { useState, useEffect, useRef } from 'react';
import { loadAuthorProfile } from '../lib/authorStorage';
import { 
  Bot, 
  Play, 
  Square, 
  Settings2, 
  BrainCircuit, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileText, 
  GraduationCap, 
  ChevronDown, 
  ChevronUp,
  Activity,
  Zap,
  Check,
  ChevronRight
} from 'lucide-react';
import type { 
  Story, 
  Chapter, 
  AgentState, 
  AgentEventType, 
  AgentConfig, 
  AgentResultSummary 
} from '../types';

interface AgentPanelProps {
  story: Story;
  currentDraft: string;
  activeChapter: Chapter | undefined;
  selectedModel: string;
  llmProvider: string;
  llmApiFields: Record<string, unknown>;
  onInsertText: (text: string, actionType?: "append" | "replace") => void;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'thought' | 'tool' | 'info' | 'error';
  content: string;
  toolName?: string;
}

export default function AgentPanel({
  story,
  currentDraft,
  activeChapter,
  selectedModel,
  llmProvider,
  llmApiFields,
  onInsertText
}: AgentPanelProps) {
  // Config state
  const [taskType, setTaskType] = useState('draft');
  const [showConfig, setShowConfig] = useState(false);
  const [craftThreshold, setCraftThreshold] = useState(65);
  const [minWords, setMinWords] = useState(1500);
  const [maxWords, setMaxWords] = useState(3000);
  const [depth, setDepth] = useState<'fast' | 'balance' | 'max'>('balance');

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [currentState, setCurrentState] = useState<string>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Clean up SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleLaunch = async () => {
    if (isRunning) return;

    // Reset state
    setLogs([]);
    setEvaluation(null);
    setResult(null);
    setError(null);
    setCurrentState('planning');
    setIsRunning(true);

    // Маппинг taskType: UI-значения → канонические API-значения
    const taskTypeMap: Record<string, string> = {
      draft: 'write_chapter',
      rewrite: 'rewrite_chapter',
      continue: 'continue_text',
      scene: 'write_scene',
    };
    const canonTaskType = taskTypeMap[taskType] ?? taskType;

    // Маппинг depth: UI-значения → канонические для humanizeDepth
    const depthMap: Record<string, string> = {
      fast: 'fast',
      balance: 'balanced',
      max: 'maximum',
    };
    const humanizeDepth = depthMap[depth] ?? 'balanced';

    // Найти предыдущую главу (для континуитета)
    let previousChapterContent = '';
    if (activeChapter && story.chapters.length > 1) {
      const chapIdx = story.chapters.findIndex(c => c.id === activeChapter.id);
      if (chapIdx > 0) {
        previousChapterContent = story.chapters[chapIdx - 1].content || '';
      }
    }

    // Загрузить паспорт автора (для стиля)
    const profile = await loadAuthorProfile(story.id);

    try {
      const response = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Тип задачи (API-каноническое значение)
          taskType: canonTaskType,
          storyId: story.id,
          chapterId: activeChapter?.id,

          // Полный input для оркестратора
          input: {
            title: story.title,
            genre: story.genre,
            description: story.description,
            chapterTitle: activeChapter?.title || '',
            chapterSummary: activeChapter?.summary || '',
            previousChapter: previousChapterContent,
            worldBible: story.worldBible || '',
            bookPlan: story.bookPlan || '',
            customPrompt: '',
            authorSample: profile?.sample || '',
            voiceSheet: profile?.voiceSheet,
          },

          // Конфиг плоский как ожидает сервер
          minCraftScore: craftThreshold,
          targetWordCountMin: minWords,
          targetWordCountMax: maxWords,
          humanizeDepth,

          // Провайдер и модель из настроек UI
          model: selectedModel,
          llmProvider,
          apiKeys: llmApiFields,
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as any;
        throw new Error(errData?.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const newTaskId = data.taskId;
      setTaskId(newTaskId);

      // Connect SSE
      connectSSE(newTaskId);
    } catch (err: any) {
      setError(err.message || 'Unknown error starting agent');
      setIsRunning(false);
      setCurrentState('idle');
    }
  };

  const connectSSE = (id: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/agent/stream/${id}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'state_change':
            // Сервер шлёт {from, to} — используем data.to
            setCurrentState(data.to);
            addLog('info', `Переход: ${data.from} → ${data.to}`);
            break;
            
          case 'reasoning':
            // Сервер шлёт {thought} — не 'thought' не 'content'
            addLog('thought', data.thought || '');
            break;
            
          case 'tool_call':
            // Сервер шлёт {tool, args} — не content/toolName
            addLog('tool', JSON.stringify(data.args || {}), data.tool);
            break;

          case 'tool_result':
            addLog('info', `Инструмент ${data.tool}: ${data.summary}`);
            break;
            
          case 'draft_preview':
            addLog('info', `Черновик готов: ${data.wordCount} слов`);
            break;

          case 'evaluation':
            // Данные на корне события, не вложены
            setEvaluation({
              craftScore: data.craftScore,
              burstiness: data.burstiness,
              issues: data.issues || [],
            });
            break;

          case 'correction':
            addLog('info', `Проход правки ${data.pass}: улучшено ${(data.improved || []).length} блоков`);
            break;
            
          case 'completed':
            // Сервер шлёт 'completed', фронтенд ждал 'result'
            setResult(data.result);
            setCurrentState('completed');
            setIsRunning(false);
            es.close();
            break;
            
          case 'error':
            // Сервер шлёт {message, recoverable} — не {error}
            setError(data.message || 'Ошибка агента');
            setIsRunning(false);
            setCurrentState('error');
            if (!data.recoverable) es.close();
            break;
        }
      } catch (err) {
        console.error('Error parsing SSE data', err);
      }
    };

    es.onerror = () => {
      // Handle connection error
      if (isRunning) {
        setError('Connection lost. Agent may still be running.');
        setIsRunning(false);
      }
      es.close();
    };
  };

  const handleStop = async () => {
    if (!taskId) return;
    
    try {
      await fetch(`/api/agent/stop/${taskId}`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop agent', err);
    } finally {
      setIsRunning(false);
      setCurrentState('idle');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      addLog('info', 'Выполнение остановлено пользователем.');
    }
  };

  const addLog = (type: LogEntry['type'], content: string, toolName?: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp,
      type,
      content,
      toolName
    }]);
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-emerald-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-rose-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 70) return 'bg-emerald-500';
    if (score >= 50) return 'bg-yellow-500';
    return 'bg-rose-500';
  };

  const states = [
    { id: 'planning', label: 'План' },
    { id: 'context', label: 'Контекст' },
    { id: 'drafting', label: 'Драфт' },
    { id: 'evaluating', label: 'Оценка' },
    { id: 'correcting', label: 'Правки' },
    { id: 'auditing', label: 'Аудит' },
    { id: 'completed', label: 'Готово' }
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 text-slate-100 overflow-y-auto w-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
            AI Агент
          </h2>
        </div>
        <p className="text-xs text-slate-400">Автономный писательский ассистент</p>
      </div>

      <div className="p-4 flex flex-col gap-6">
        
        {/* Task Launcher */}
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-4 shadow-sm flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-300">Тип задачи</label>
            <select 
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              disabled={isRunning}
            >
              <option value="draft">Написать главу</option>
              <option value="rewrite">Переписать главу</option>
              <option value="continue">Продолжить текст</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-700/50 pt-3">
            <button 
              className="flex items-center justify-between text-sm text-slate-300 hover:text-white transition-colors disabled:opacity-50"
              onClick={() => setShowConfig(!showConfig)}
              disabled={isRunning}
            >
              <span className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Настройки генерации
              </span>
              {showConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            
            {showConfig && (
              <div className="flex flex-col gap-4 mt-2 p-3 bg-slate-900/50 rounded-lg border border-slate-700/30">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Порог качества: {craftThreshold}</span>
                  </div>
                  <input 
                    type="range" 
                    min="30" max="95" 
                    value={craftThreshold}
                    onChange={(e) => setCraftThreshold(parseInt(e.target.value))}
                    className="w-full accent-violet-500"
                    disabled={isRunning}
                  />
                </div>
                
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400 mb-1">Слов в главе (от - до)</label>
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      min="100" max="10000" step="100"
                      value={minWords}
                      onChange={(e) => setMinWords(parseInt(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm outline-none focus:border-violet-500 disabled:opacity-50"
                      disabled={isRunning}
                    />
                    <input 
                      type="number" 
                      min="100" max="10000" step="100"
                      value={maxWords}
                      onChange={(e) => setMaxWords(parseInt(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm outline-none focus:border-violet-500 disabled:opacity-50"
                      disabled={isRunning}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400 mb-1">Глубина проработки</label>
                  <div className="flex rounded-lg overflow-hidden border border-slate-700 disabled:opacity-50">
                    <button 
                      className={`flex-1 py-1 text-xs transition-colors ${depth === 'fast' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                      onClick={() => setDepth('fast')}
                      disabled={isRunning}
                    >
                      Быстро
                    </button>
                    <button 
                      className={`flex-1 py-1 text-xs transition-colors border-l border-slate-700 ${depth === 'balance' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                      onClick={() => setDepth('balance')}
                      disabled={isRunning}
                    >
                      Баланс
                    </button>
                    <button 
                      className={`flex-1 py-1 text-xs transition-colors border-l border-slate-700 ${depth === 'max' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                      onClick={() => setDepth('max')}
                      disabled={isRunning}
                    >
                      Максимум
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-2">
            {!isRunning ? (
              <button 
                onClick={handleLaunch}
                className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-medium hover:from-violet-500 hover:to-purple-500 transition-all shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:shadow-[0_0_20px_rgba(139,92,246,0.5)] active:scale-[0.98]"
              >
                <Bot className="w-5 h-5" />
                Запустить агента
              </button>
            ) : (
              <button 
                onClick={handleStop}
                className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 bg-slate-800 text-rose-400 font-medium hover:bg-slate-700 transition-all border border-rose-900/50"
              >
                <Square className="w-4 h-4" />
                Остановить
              </button>
            )}
          </div>
          
          {error && (
            <div className="text-sm text-rose-400 bg-rose-900/20 p-3 rounded-lg border border-rose-900/50 flex gap-2 items-start mt-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Live Progress */}
        {(isRunning || currentState !== 'idle') && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-4 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              Процесс
            </h3>
            
            {/* State machine viz */}
            <div className="flex items-center justify-between px-1">
              {states.map((s, i) => {
                const isActive = currentState === s.id;
                const isPast = states.findIndex(x => x.id === currentState) > i || currentState === 'completed';
                
                return (
                  <React.Fragment key={s.id}>
                    <div className="flex flex-col items-center gap-1 relative group">
                      <div 
                        className={`w-3 h-3 rounded-full transition-all duration-300 z-10 
                          ${isActive ? 'bg-violet-500 scale-125 shadow-[0_0_10px_rgba(139,92,246,0.8)]' : 
                            isPast ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      />
                      {isActive && <div className="absolute top-0 w-3 h-3 rounded-full bg-violet-400 animate-ping opacity-75 z-0" />}
                      
                      {/* Tooltip */}
                      <div className="absolute top-5 scale-0 group-hover:scale-100 transition-transform origin-top bg-slate-900 text-[10px] px-2 py-1 rounded border border-slate-700 whitespace-nowrap z-20">
                        {s.label}
                      </div>
                    </div>
                    {i < states.length - 1 && (
                      <div className={`flex-1 h-[2px] transition-all duration-500 ${isPast ? 'bg-emerald-500/50' : 'bg-slate-700'}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Reasoning stream */}
            <div className="bg-slate-900 rounded-lg border border-slate-700/50 h-[240px] p-3 overflow-y-auto flex flex-col gap-2 font-mono text-sm relative">
              {logs.length === 0 ? (
                <div className="text-slate-500 flex items-center justify-center h-full text-xs italic">
                  Ожидание инициализации...
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 text-xs leading-relaxed">
                    <span className="text-slate-500 shrink-0 select-none">[{log.timestamp}]</span>
                    {log.type === 'tool' ? (
                      <div className="flex flex-col gap-1 w-full">
                        <div className="flex items-center gap-1.5">
                          <span className="bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {log.toolName || 'tool'}
                          </span>
                        </div>
                        <span className="text-slate-300 pl-1">{log.content}</span>
                      </div>
                    ) : log.type === 'thought' ? (
                      <span className="text-slate-400 italic flex-1">
                        <BrainCircuit className="w-3 h-3 inline mr-1 text-slate-500" />
                        {log.content}
                      </span>
                    ) : (
                      <span className="text-slate-300 flex-1">{log.content}</span>
                    )}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Evaluation Dashboard */}
        {evaluation && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-4 shadow-sm flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Оценка текста
            </h3>
            
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full border-4 border-slate-700 bg-slate-900 relative">
                <span className={`text-2xl font-bold ${getScoreColor(evaluation.craftScore || 0)}`}>
                  {evaluation.craftScore || 0}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Score</span>
                
                {/* SVG Ring */}
                <svg className="absolute top-[-4px] left-[-4px] w-20 h-20 -rotate-90 pointer-events-none">
                  <circle 
                    cx="40" cy="40" r="38" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="4" 
                    className={`${getScoreColor(evaluation.craftScore || 0)} opacity-50`}
                    strokeDasharray={`${((evaluation.craftScore || 0) / 100) * 238} 238`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="flex-1 flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Craft Score</span>
                    <span>{evaluation.craftScore || 0}/100</span>
                  </div>
                  <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getScoreBg(evaluation.craftScore || 0)} transition-all duration-1000`} 
                      style={{ width: `${evaluation.craftScore || 0}%` }}
                    />
                  </div>
                </div>
                
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Burstiness</span>
                    <span>{evaluation.burstiness || 0}</span>
                  </div>
                  <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-1000" 
                      style={{ width: `${Math.min((evaluation.burstiness || 0) * 10, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {evaluation.issues && evaluation.issues.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-400">Найденные проблемы:</span>
                <ul className="text-xs text-slate-300 flex flex-col gap-1.5 pl-1">
                  {evaluation.issues.map((issue: string, idx: number) => (
                    <li key={idx} className="flex gap-2 items-start">
                      <AlertCircle className="w-3 h-3 text-yellow-500 shrink-0 mt-0.5" />
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Result Section */}
        {result && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 p-4 shadow-sm flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-400" />
              Результат
            </h3>

            <div className="flex gap-4 mb-2">
              <div className="flex-1 bg-slate-900 rounded-lg p-3 border border-slate-700 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-slate-200">{result.wordCount || 0}</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Слов</span>
              </div>
              <div className="flex-1 bg-slate-900 rounded-lg p-3 border border-slate-700 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-slate-200 flex items-center gap-1">
                  <Clock className="w-4 h-4 text-slate-400" />
                  {result.duration || '0s'}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Время</span>
              </div>
            </div>

            <button 
              className="flex items-center justify-between text-sm text-slate-300 hover:text-white transition-colors bg-slate-900 p-2 rounded-lg border border-slate-700"
              onClick={() => setShowPreview(!showPreview)}
            >
              <span>Предпросмотр текста</span>
              {showPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            
            {showPreview && result.text && (
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-sm text-slate-300 max-h-[300px] overflow-y-auto whitespace-pre-wrap font-serif leading-relaxed">
                {result.text}
              </div>
            )}

            <button 
              onClick={() => onInsertText(result.text || '', 'append')}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 bg-violet-600 text-white font-medium hover:bg-violet-500 transition-all mt-2"
            >
              <Check className="w-4 h-4" />
              Вставить в главу
            </button>
          </div>
        )}

        {/* Learning Feedback */}
        {result && (
          <div className="rounded-xl bg-indigo-900/20 border border-indigo-500/30 p-4 shadow-sm flex flex-col gap-3 animate-in fade-in duration-700 delay-300">
            <h3 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
              <GraduationCap className="w-4 h-4" />
              Обучение агента
            </h3>
            <p className="text-xs text-indigo-200/70 leading-relaxed">
              Отредактируйте сгенерированный текст в основном редакторе, исправляя стилистику под себя, 
              затем нажмите «Обучить», чтобы агент подстроил свой промпт под ваш стиль.
            </p>
            <button className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 bg-indigo-600/30 text-indigo-200 hover:bg-indigo-600/50 hover:text-white transition-all border border-indigo-500/50 text-sm mt-1">
              <GraduationCap className="w-4 h-4" />
              Обучить на моих правках
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
