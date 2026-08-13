import React, { useState, useEffect, useMemo } from "react";
import { Users, Map, BookOpen, Plus, Trash2, Edit3, Save, X, Search, Tag, Database, Clock3, RefreshCw } from "lucide-react";
import { CodexEntry, Story } from "../types";
import { listCodexEntries, saveCodexEntry, deleteCodexEntry } from "../lib/authorStorage";
import { indexCodexMentions } from "../lib/codexRetrieval";

interface CodexPanelProps {
  story: Story;
}

type TabType = "all" | "character" | "location" | "lore";

export default function CodexPanel({ story }: CodexPanelProps) {
  const storyId = story?.id || "";
  const [entries, setEntries] = useState<CodexEntry[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [search, setSearch] = useState("");
  
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  
  // Form State
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"character" | "location" | "lore">("character");
  const [formDescription, setFormDescription] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formAliases, setFormAliases] = useState("");
  const [formValidFromChapterId, setFormValidFromChapterId] = useState("");
  const [formValidToChapterId, setFormValidToChapterId] = useState("");
  const [formTemporalNote, setFormTemporalNote] = useState("");
  const [indexingMentions, setIndexingMentions] = useState(false);

  const fetchEntries = async () => {
    if (!storyId) return;
    try {
      const data = await listCodexEntries(storyId);
      setEntries(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [storyId]);

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesTab = activeTab === "all" || e.type === activeTab;
      const matchesSearch = search === "" || 
        e.name.toLowerCase().includes(search.toLowerCase()) || 
        e.description.toLowerCase().includes(search.toLowerCase()) ||
        e.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
      return matchesTab && matchesSearch;
    });
  }, [entries, activeTab, search]);

  const handleCreate = () => {
    setSelectedEntryId(null);
    setIsEditing(true);
    setFormName("");
    setFormType(activeTab === "all" ? "character" : activeTab);
    setFormDescription("");
    setFormTags("");
    setFormAliases("");
    setFormValidFromChapterId("");
    setFormValidToChapterId("");
    setFormTemporalNote("");
  };

  const handleEdit = (entry: CodexEntry) => {
    setSelectedEntryId(entry.id);
    setIsEditing(true);
    setFormName(entry.name);
    setFormType(entry.type);
    setFormDescription(entry.description);
    setFormTags(entry.tags.join(", "));
    setFormAliases((entry.aliases || []).join(", "));
    setFormValidFromChapterId(entry.temporal?.validFromChapterId || "");
    setFormValidToChapterId(entry.temporal?.validToChapterId || "");
    setFormTemporalNote(entry.temporal?.note || "");
  };

  const handleDelete = async (id: string) => {
    if (confirm("Удалить запись из кодекса?")) {
      await deleteCodexEntry(id);
      await fetchEntries();
      if (selectedEntryId === id) {
        setIsEditing(false);
        setSelectedEntryId(null);
      }
    }
  };

  const handleSave = async () => {
    if (!formName.trim()) return;

    const tagsArray = formTags.split(",").map(t => t.trim()).filter(Boolean);
    const now = Date.now();
    
    const entry: CodexEntry = {
      id: selectedEntryId || `codex-${Math.random().toString(36).substr(2, 9)}`,
      storyId,
      type: formType,
      name: formName.trim(),
      description: formDescription.trim(),
      tags: tagsArray,
      aliases: formAliases.split(",").map((alias) => alias.trim()).filter(Boolean),
      temporal: formValidFromChapterId || formValidToChapterId || formTemporalNote.trim()
        ? { validFromChapterId: formValidFromChapterId || undefined, validToChapterId: formValidToChapterId || undefined, note: formTemporalNote.trim() || undefined }
        : undefined,
      mentions: selectedEntryId ? entries.find((entry) => entry.id === selectedEntryId)?.mentions || [] : [],
      createdAt: selectedEntryId ? entries.find(e => e.id === selectedEntryId)?.createdAt || now : now,
      updatedAt: now,
    };

    await saveCodexEntry(entry);
    await fetchEntries();
    setIsEditing(false);
    setSelectedEntryId(entry.id);
  };

  const refreshMentionIndex = async () => {
    if (!entries.length) return;
    setIndexingMentions(true);
    try {
      const indexed = indexCodexMentions(entries, story.chapters);
      await Promise.all(indexed.map((entry) => saveCodexEntry({ ...entry, updatedAt: Date.now() })));
      setEntries(indexed);
    } finally {
      setIndexingMentions(false);
    }
  };

  const handleImportFromProject = async () => {
    if (!story) return;
    
    let imported = 0;
    
    // Import characters
    for (const char of story.characters || []) {
      if (!entries.some(e => e.type === 'character' && e.name === char.name)) {
        const entry: CodexEntry = {
          id: `codex-${Math.random().toString(36).substr(2, 9)}`,
          storyId: story.id,
          type: 'character',
          name: char.name,
          description: char.role || "",
          tags: ["персонаж"],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        await saveCodexEntry(entry);
        imported++;
      }
    }
    
    // Import world rules
    for (const rule of story.worldRules || []) {
      if (!entries.some(e => e.type === 'lore' && e.name === rule.title)) {
        const entry: CodexEntry = {
          id: `codex-${Math.random().toString(36).substr(2, 9)}`,
          storyId: story.id,
          type: 'lore',
          name: rule.title,
          description: rule.content || "",
          tags: ["лор"],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        await saveCodexEntry(entry);
        imported++;
      }
    }
    
    if (imported > 0) {
      await fetchEntries();
      alert(`Успешно импортировано ${imported} записей из текущего проекта.`);
    } else {
      alert("Не найдено новых данных для импорта (все персонажи и правила уже в кодексе).");
    }
  };

  const getIcon = (type: string) => {
    if (type === "character") return <Users className="w-4 h-4 text-emerald-400" />;
    if (type === "location") return <Map className="w-4 h-4 text-blue-400" />;
    return <BookOpen className="w-4 h-4 text-amber-400" />;
  };

  const getTypeLabel = (type: string) => {
    if (type === "character") return "Персонаж";
    if (type === "location") return "Локация";
    return "Лор";
  };

  return (
    <div className="flex flex-col h-full bg-slate-950/40 backdrop-blur-xl border-l border-white/5 text-sm font-sans relative overflow-hidden">
      {/* Header */}
      <div className="flex-none p-4 border-b border-white/10 bg-slate-900/50">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 drop-shadow-md">
            <Database className="w-5 h-5 text-indigo-400" />
            Кодекс (Story Bible)
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => void refreshMentionIndex()} disabled={indexingMentions || entries.length === 0} className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-md transition-all border border-white/10" title="Обновить индекс упоминаний в главах">
              <RefreshCw className={`w-4 h-4 ${indexingMentions ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={handleCreate}
              className="p-1.5 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded-md transition-all shadow-lg border border-indigo-500/30 backdrop-blur-md"
              title="Добавить запись"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-3 bg-slate-950/50 p-1 rounded-lg border border-white/5">
          {[
            { id: "all", label: "Все" },
            { id: "character", label: "Персонажи", icon: <Users className="w-3.5 h-3.5" /> },
            { id: "location", label: "Локации", icon: <Map className="w-3.5 h-3.5" /> },
            { id: "lore", label: "Лор", icon: <BookOpen className="w-3.5 h-3.5" /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                activeTab === tab.id 
                  ? "bg-slate-800 text-white shadow-md border border-white/10" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск по кодексу..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900/80 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {isEditing ? (
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-5 border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-slate-100 text-base flex items-center gap-2">
                {selectedEntryId ? <Edit3 className="w-4 h-4 text-blue-400" /> : <Plus className="w-4 h-4 text-emerald-400" />}
                {selectedEntryId ? "Редактировать запись" : "Новая запись"}
              </h3>
              <button onClick={() => setIsEditing(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5 uppercase tracking-wider font-semibold">Название</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  placeholder="Имя, название места или события..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-slate-400 text-xs mb-1.5 uppercase tracking-wider font-semibold">Тип записи</label>
                <div className="flex gap-2">
                  {(["character", "location", "lore"] as const).map((t) => (
                    <label key={t} className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${formType === t ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200' : 'bg-slate-950/30 border-white/5 text-slate-400 hover:bg-slate-900'}`}>
                      <input type="radio" name="entryType" value={t} checked={formType === t} onChange={() => setFormType(t)} className="hidden" />
                      {getIcon(t)}
                      <span className="text-xs">{getTypeLabel(t)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-xs mb-1.5 uppercase tracking-wider font-semibold">Описание</label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all custom-scrollbar resize-none"
                  placeholder="Подробное описание..."
                />
              </div>

              <div>
                <label className="block text-slate-400 text-xs mb-1.5 uppercase tracking-wider font-semibold">Теги (через запятую)</label>
                <div className="relative">
                  <Tag className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={formTags}
                    onChange={e => setFormTags(e.target.value)}
                    className="w-full bg-slate-950/50 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                    placeholder="магия, столица, древний..."
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-slate-400 text-xs mb-1.5 uppercase tracking-wider font-semibold">Псевдонимы и варианты имени</label>
                <input value={formAliases} onChange={(event) => setFormAliases(event.target.value)} className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" placeholder="например: Ник, Ника, Николай — через запятую" />
              </div>

              <div className="rounded-lg border border-indigo-900/40 bg-indigo-950/15 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-200"><Clock3 className="w-3.5 h-3.5" />Временная применимость факта</div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={formValidFromChapterId} onChange={(event) => setFormValidFromChapterId(event.target.value)} className="bg-slate-950/50 border border-white/10 rounded-lg px-2 py-2 text-xs text-slate-200"><option value="">С начала книги</option>{story.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>С: {chapter.title}</option>)}</select>
                  <select value={formValidToChapterId} onChange={(event) => setFormValidToChapterId(event.target.value)} className="bg-slate-950/50 border border-white/10 rounded-lg px-2 py-2 text-xs text-slate-200"><option value="">Действует далее</option>{story.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>До: {chapter.title}</option>)}</select>
                </div>
                <input value={formTemporalNote} onChange={(event) => setFormTemporalNote(event.target.value)} className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200" placeholder="Примечание: что изменило факт и почему" />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors text-xs font-medium"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formName.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-all text-xs font-medium flex items-center gap-1.5 shadow-lg shadow-indigo-900/20"
                >
                  <Save className="w-3.5 h-3.5" />
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEntries.length === 0 ? (
              <div className="text-center py-10 opacity-60">
                <Database className="w-10 h-10 mx-auto mb-3 text-slate-500" />
                <p className="text-slate-400 text-sm">Ничего не найдено.</p>
                {search === "" && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-slate-500 text-xs">Добавьте первую запись в кодекс!</p>
                    <button 
                      onClick={handleImportFromProject}
                      className="mt-2 px-4 py-2 bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded border border-indigo-500/30 transition-all text-xs"
                    >
                      Импортировать из текущего проекта
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredEntries.map(entry => (
                <div 
                  key={entry.id} 
                  className="group bg-slate-900/40 hover:bg-slate-800/60 border border-white/5 hover:border-white/10 rounded-xl p-3.5 transition-all cursor-pointer shadow-sm hover:shadow-md"
                  onClick={() => {
                    // if it was just clicking, maybe open detail view. 
                    // Let's just open the edit view for simplicity and speed.
                    handleEdit(entry);
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-950/50 rounded-lg border border-white/5">
                        {getIcon(entry.type)}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-200 group-hover:text-white transition-colors">{entry.name}</h4>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{getTypeLabel(entry.type)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleEdit(entry); }}
                        className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-md transition-colors"
                        title="Редактировать"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  
                  {entry.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-2">
                      {entry.description}
                    </p>
                  )}
                  
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {entry.tags.map((tag, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-950/50 border border-white/5 text-slate-400 rounded-md">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {(entry.temporal?.validFromChapterId || entry.temporal?.validToChapterId || entry.temporal?.note) && <p className="mt-2 flex items-center gap-1 text-[10px] text-indigo-300"><Clock3 className="w-3 h-3" />{entry.temporal?.note || "У записи задан временной диапазон"}</p>}
                  {entry.mentions?.length ? <p className="mt-1 text-[10px] text-slate-500">Упоминаний в главах: {entry.mentions.length}</p> : null}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
