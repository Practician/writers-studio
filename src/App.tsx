import React, { useState, useEffect, useRef } from "react";
// mammoth (~400 КБ) загружается динамически только при импорте .docx — см. extractDocxText
const extractDocxText = async (arrayBuffer: ArrayBuffer): Promise<string> => {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};
import { 
  BookOpen, 
  Plus, 
  Trash2, 
  Sparkles, 
  FileText, 
  Wand2, 
  ChevronRight, 
  Download, 
  Eye, 
  EyeOff, 
  BookMarked,
  Info,
  Layers,
  Sparkle,
  Upload,
  Globe,
  Check,
  Save,
  Settings,
  Cpu
} from "lucide-react";
import { Story, Chapter, Character, WorldRule, TextSelection, AuthorEditTarget } from "./types";
import { hashText } from "./lib/authorAudit";
import { DEFAULT_STORIES } from "./defaultData";
// Боковые панели грузятся лениво: они не нужны при первом рендере редактора,
// а MuseChat/AIPanel тянут за собой react-markdown со всей remark-экосистемой.
const MuseChat = React.lazy(() => import("./components/MuseChat"));
const CharacterManager = React.lazy(() => import("./components/CharacterManager"));
const WorldBuilder = React.lazy(() => import("./components/WorldBuilder"));
const AIPanel = React.lazy(() => import("./components/AIPanel"));

export default function App() {
  const [stories, setStories] = useState<Story[]>([]);
  const storiesRef = useRef<Story[]>([]);
  storiesRef.current = stories;
  const [selectedStoryId, setSelectedStoryId] = useState<string>("");
  const [selectedChapterId, setSelectedChapterId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"muse" | "characters" | "world" | "ai">(() => {
    return (localStorage.getItem("writers_studio_global_active_tab") as any) || "muse";
  });
  const [selectedText, setSelectedText] = useState("");
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [openAuthorRequest, setOpenAuthorRequest] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showStoryDetailsModal, setShowStoryDetailsModal] = useState(false);
  const [showNewStoryModal, setShowNewStoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Model Selection state
  const selectedModel = "gemini-3.5-flash";

  // Chapter Publishing states
  const [showPublishSuccessModal, setShowPublishSuccessModal] = useState(false);
  const [publishedChapterDetails, setPublishedChapterDetails] = useState<{ title: string; wordCount: number } | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // Metadata Edit States (Modal)
  const [editTitle, setEditTitle] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editBookPlan, setEditBookPlan] = useState("");
  const [editWorldBible, setEditWorldBible] = useState("");
  const [editCustomPrompt, setEditCustomPrompt] = useState("");
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingBible, setIsGeneratingBible] = useState(false);

  // File Import state
  const [importTarget, setImportTarget] = useState<"chapter" | "worldRule" | "character" | "currentChapter" | "auto" | "bookPlan" | "worldBible">("chapter");
  const [importFileTitle, setImportFileTitle] = useState("");
  const [importFileContent, setImportFileContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parsedResult, setParsedResult] = useState<{
    chapters: Array<{ title: string; summary: string; content: string }>;
    characters: Array<{ name: string; role: string; traits: string; goals: string; description: string }>;
    worldRules: Array<{ title: string; content: string }>;
  } | null>(null);

  // New Story Form state
  const [newTitle, setNewTitle] = useState("");
  const [newGenre, setNewGenre] = useState("Фантастика");
  const [newDesc, setNewDesc] = useState("");
  const [newWorldBible, setNewWorldBible] = useState("");
  const [newBookPlan, setNewBookPlan] = useState("");
  const [newBibleFileName, setNewBibleFileName] = useState("");
  const [newPlanFileName, setNewPlanFileName] = useState("");
  const [isCreatingStory, setIsCreatingStory] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);

  // Handle files for New Book Modal
  const handleNewBibleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewBibleFileName(file.name);
    
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          setNewWorldBible(await extractDocxText(arrayBuffer));
        } catch (err) {
          alert("Ошибка при чтении Word файла.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewWorldBible(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const handleNewPlanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewPlanFileName(file.name);
    
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          setNewBookPlan(await extractDocxText(arrayBuffer));
        } catch (err) {
          alert("Ошибка при чтении Word файла.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewBookPlan(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track and save active tab
  useEffect(() => {
    if (activeTab) {
      localStorage.setItem("writers_studio_global_active_tab", activeTab);
      if (selectedStoryId) {
        localStorage.setItem(`writers_studio_active_tab_${selectedStoryId}`, activeTab);
      }
    }
  }, [activeTab, selectedStoryId]);

  // Track and save selected story ID
  useEffect(() => {
    if (selectedStoryId) {
      localStorage.setItem("writers_studio_selected_story_id", selectedStoryId);
      
      // Restore this specific story's active tab
      const savedStoryTab = localStorage.getItem(`writers_studio_active_tab_${selectedStoryId}`);
      if (savedStoryTab) {
        setActiveTab(savedStoryTab as any);
      }
      
      // Restore this specific story's active chapter
      const savedStoryChapter = localStorage.getItem(`writers_studio_active_chapter_${selectedStoryId}`);
      const story = storiesRef.current.find(s => s.id === selectedStoryId);
      if (story) {
        const chapterExists = story.chapters?.find(c => c.id === savedStoryChapter);
        if (chapterExists && savedStoryChapter) {
          setSelectedChapterId(savedStoryChapter);
        } else if (story.chapters && story.chapters.length > 0) {
          setSelectedChapterId(story.chapters[0].id);
        }
      }
    }
  }, [selectedStoryId]);

  // Track and save selected chapter ID
  useEffect(() => {
    if (selectedChapterId) {
      localStorage.setItem("writers_studio_selected_chapter_id", selectedChapterId);
      if (selectedStoryId) {
        localStorage.setItem(`writers_studio_active_chapter_${selectedStoryId}`, selectedChapterId);
      }
    }
  }, [selectedChapterId, selectedStoryId]);

  // 1. Initial Load and Seeding
  useEffect(() => {
    const saved = localStorage.getItem("writers_studio_stories");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) {
          setStories(parsed);
          
          const savedStoryId = localStorage.getItem("writers_studio_selected_story_id");
          const savedChapterId = localStorage.getItem("writers_studio_selected_chapter_id");
          
          // Sort by updatedAt descending to fallback to the most recently edited story
          const sorted = [...parsed].sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const targetStory = parsed.find((s: any) => s.id === savedStoryId) || sorted[0] || parsed[0];
          
          setSelectedStoryId(targetStory.id);
          
          const chapterExists = targetStory.chapters?.find((c: any) => c.id === savedChapterId);
          if (chapterExists) {
            setSelectedChapterId(savedChapterId);
          } else if (targetStory.chapters && targetStory.chapters.length > 0) {
            setSelectedChapterId(targetStory.chapters[0].id);
          }
          return;
        }
      } catch (e) {
        console.error("Failed to parse stories", e);
      }
    }

    // Seed default
    setStories(DEFAULT_STORIES);
    setSelectedStoryId(DEFAULT_STORIES[0].id);
    setSelectedChapterId(DEFAULT_STORIES[0].chapters[0].id);
    localStorage.setItem("writers_studio_stories", JSON.stringify(DEFAULT_STORIES));
  }, []);

  // Get active story and active chapter
  const activeStory = stories.find(s => s.id === selectedStoryId) || stories[0];
  const activeChapter = activeStory?.chapters.find(c => c.id === selectedChapterId) || activeStory?.chapters[0];

  // Sync edit story metadata states when modal opens or active story changes
  useEffect(() => {
    if (showStoryDetailsModal && activeStory) {
      setEditTitle(activeStory.title);
      setEditGenre(activeStory.genre);
      setEditDesc(activeStory.description);
      setEditBookPlan(activeStory.bookPlan || "");
      setEditWorldBible(activeStory.worldBible || "");
      setEditCustomPrompt("");
    }
  }, [showStoryDetailsModal, activeStory]);

  // 2. Auto-save triggers
  const saveAllStories = (updatedStories: Story[]) => {
    setStories(updatedStories);
    setIsSaving(true);
    localStorage.setItem("writers_studio_stories", JSON.stringify(updatedStories));
    setTimeout(() => setIsSaving(false), 800);
  };

  // 3. Handle Editor Changes
  const handleEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeStory || !activeChapter) return;
    
    const newContent = e.target.value;
    if (textSelection) {
      setTextSelection(null);
      setSelectedText("");
    }
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === activeChapter.id ? { ...c, content: newContent } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    const updatedStories = stories.map(s => 
      s.id === activeStory.id ? updatedStory : s
    );

    saveAllStories(updatedStories);
  };

  // 4. Track Text Selection (for style improver)
  const handleTextSelection = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      if (start !== end) {
        const text = textareaRef.current.value.substring(start, end);
        setSelectedText(text);
        if (activeChapter) {
          setTextSelection({
            chapterId: activeChapter.id,
            start,
            end,
            text,
            sourceHash: hashText(textareaRef.current.value),
          });
        }
      } else {
        setSelectedText("");
        setTextSelection(null);
      }
    }
  };

  // 5. Insert AI generation results (Append or Replace selection)
  const handleInsertText = (aiText: string, actionType: "append" | "replace") => {
    if (!textareaRef.current || !activeChapter || !activeStory) return;

    let newContent = "";
    if (
      actionType === "replace" &&
      textSelection &&
      textSelection.chapterId === activeChapter.id &&
      textSelection.sourceHash === hashText(activeChapter.content) &&
      activeChapter.content.slice(textSelection.start, textSelection.end) === textSelection.text
    ) {
      const start = textSelection.start;
      const end = textSelection.end;
      const currentVal = textareaRef.current.value;
      newContent = currentVal.substring(0, start) + aiText + currentVal.substring(end);
    } else {
      // Append at the end or at the current cursor
      const cursor = textareaRef.current.selectionStart || textareaRef.current.value.length;
      const currentVal = textareaRef.current.value;
      newContent = currentVal.substring(0, cursor) + "\n\n" + aiText + currentVal.substring(cursor);
    }

    // Sync state and save
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === activeChapter.id ? { ...c, content: newContent } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    setSelectedText("");
    setTextSelection(null);
  };

  const handleApplyAuthorEdit = (text: string, target: AuthorEditTarget): boolean => {
    if (!activeStory || !activeChapter || target.chapterId !== activeChapter.id) return false;
    const currentContent = activeChapter.content;
    if (hashText(currentContent) !== target.sourceHash) return false;

    let newContent: string;
    if (target.kind === "chapter") {
      if (currentContent !== target.original) return false;
      newContent = text;
    } else {
      if (target.start == null || target.end == null) return false;
      if (currentContent.slice(target.start, target.end) !== target.original) return false;
      newContent = currentContent.slice(0, target.start) + text + currentContent.slice(target.end);
    }

    const updatedChapters = activeStory.chapters.map((chapter) =>
      chapter.id === activeChapter.id ? { ...chapter, content: newContent } : chapter
    );
    const updatedStory = { ...activeStory, chapters: updatedChapters, updatedAt: Date.now() };
    saveAllStories(stories.map((story) => story.id === activeStory.id ? updatedStory : story));
    setSelectedText("");
    setTextSelection(null);
    return true;
  };

  // 6. Chapter Management
  const handleAddChapter = () => {
    if (!activeStory) return;
    const nextNum = activeStory.chapters.length + 1;
    const newCh: Chapter = {
      id: "chapter-" + Math.random().toString(36).substr(2, 9),
      title: `Глава ${nextNum}: Новое начало`,
      summary: "Опишите краткое содержание главы...",
      content: ""
    };

    const updatedStory = {
      ...activeStory,
      chapters: [...activeStory.chapters, newCh],
      updatedAt: Date.now()
    };

    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    setSelectedChapterId(newCh.id);
  };

  const handleUpdateChapterDetails = (title: string, summary: string) => {
    if (!activeStory || !activeChapter) return;
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === activeChapter.id ? { ...c, title, summary } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  const handleDeleteChapter = (id: string) => {
    if (!activeStory) return;
    if (confirm("Вы уверены, что хотите удалить эту главу? Весь её текст будет стёрт.")) {
      const filtered = activeStory.chapters.filter(c => c.id !== id);
      const updatedStory = {
        ...activeStory,
        chapters: filtered,
        updatedAt: Date.now()
      };

      saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
      setSelectedChapterId(filtered[0]?.id || "");
    }
  };

  const handleOpenInAuthorEditor = (chapterId: string) => {
    setSelectedChapterId(chapterId);
    setSelectedText("");
    setTextSelection(null);
    setActiveTab("ai");
    setOpenAuthorRequest((value) => value + 1);
  };

  // 7. Characters/World rules update wrappers
  const handleUpdateCharacters = (chars: Character[]) => {
    if (!activeStory) return;
    const updatedStory = { ...activeStory, characters: chars, updatedAt: Date.now() };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  const handleUpdateWorldRules = (rules: WorldRule[]) => {
    if (!activeStory) return;
    const updatedStory = { ...activeStory, worldRules: rules, updatedAt: Date.now() };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  const handleUpdateStoryChapters = (chapters: Chapter[]) => {
    if (!activeStory) return;
    const updatedStory = { ...activeStory, chapters, updatedAt: Date.now() };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
  };

  // 8. Create a New Book
  const handleCreateNewStory = async () => {
    if (!newTitle.trim()) return;

    setIsCreatingStory(true);
    setCreationError(null);

    let evaluationResult = "";
    const initialWorldRules: WorldRule[] = [];
    const initialCharacters: Character[] = [];
    const initialChapters: Chapter[] = [];
    let hasParsedChapters = false;

    if (newWorldBible.trim()) {
      initialWorldRules.push({
        id: "rule-bible-" + Math.random().toString(36).substr(2, 9),
        title: "Библия мира (Сеттинг)",
        content: newWorldBible
      });
    }

    if (newWorldBible.trim() || newBookPlan.trim()) {
      try {
        // Run both evaluation and extraction in parallel for fast loading
        const [evalResponse, parseResponse] = await Promise.all([
          fetch("/api/writer/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "evaluate_idea",
              title: newTitle,
              genre: newGenre,
              description: newDesc,
              worldBible: newWorldBible,
              bookPlan: newBookPlan,
              model: selectedModel
            }),
          }),
          fetch("/api/writer/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "parse_import",
              text: `Библия мира (сеттинг):\n${newWorldBible}\n\nПлан сюжета и книга:\n${newBookPlan}`,
              model: selectedModel
            }),
          })
        ]);

        if (evalResponse.ok) {
          const evalData = await evalResponse.json();
          evaluationResult = evalData.result;
        }

        if (parseResponse.ok) {
          const parseData = await parseResponse.json();
          try {
            const parsed = JSON.parse(parseData.result);
            
            // Extract parsed characters
            if (parsed.characters && Array.isArray(parsed.characters)) {
              parsed.characters.forEach((char: any) => {
                initialCharacters.push({
                  id: "char-ext-" + Math.random().toString(36).substr(2, 9),
                  name: char.name || "Без имени",
                  role: char.role || "Главный",
                  traits: char.traits || "",
                  goals: char.goals || "",
                  description: char.description || ""
                });
              });
            }

            // Extract parsed world rules
            if (parsed.worldRules && Array.isArray(parsed.worldRules)) {
              parsed.worldRules.forEach((rule: any) => {
                if (rule.title && rule.content) {
                  initialWorldRules.push({
                    id: "rule-ext-" + Math.random().toString(36).substr(2, 9),
                    title: rule.title,
                    content: rule.content
                  });
                }
              });
            }

            // Extract parsed chapters
            if (parsed.chapters && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
              parsed.chapters.forEach((ch: any) => {
                initialChapters.push({
                  id: "chapter-ext-" + Math.random().toString(36).substr(2, 9),
                  title: ch.title || "Новая глава",
                  summary: ch.summary || "Синопсис из плана",
                  content: ch.content || ""
                });
              });
              hasParsedChapters = true;
            }
          } catch (e) {
            console.error("Failed to parse extracted JSON from Gemini", e);
          }
        }
      } catch (err) {
        console.error("Story creation extraction & evaluation error:", err);
      }
    }

    const storyId = "story-" + Math.random().toString(36).substr(2, 9);

    if (!hasParsedChapters) {
      if (newBookPlan.trim()) {
        initialChapters.push({
          id: "chapter-plan-" + Math.random().toString(36).substr(2, 9),
          title: "План сюжета",
          summary: "План и структура книги.",
          content: newBookPlan
        });
      } else {
        initialChapters.push({
          id: "chapter-1",
          title: "Глава 1: Пролог",
          summary: "Первая вводная глава.",
          content: ""
        });
      }
    }

    const newBook: Story = {
      id: storyId,
      title: newTitle,
      genre: newGenre,
      description: newDesc || "Без описания.",
      updatedAt: Date.now(),
      chapters: initialChapters,
      characters: initialCharacters,
      worldRules: initialWorldRules,
      bookPlan: newBookPlan,
      worldBible: newWorldBible
    };

    // Save Muse chat greeting + evaluation result
    const initialMessages = [];
    const extractedStats = `Я успешно извлекла для тебя: **${initialCharacters.length} персонажей** и **${initialWorldRules.length} лор-записей** прямо в твои рабочие вкладки справа! Теперь мы можем легко обращаться к ним при написании.`;
    
    if (evaluationResult) {
      initialMessages.push({
        id: "eval-asst-" + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: `Привет! Я твоя творческая Муза. ✨🎨\n\nЯ внимательно изучила загруженную тобой Библию мира и План сюжета для твоей новой книги **«${newTitle}»**.\n\n${initialCharacters.length > 0 || initialWorldRules.length > 0 ? `⚡ **Интеграция Лора и Персонажей**: ${extractedStats}\n\n` : ""}Вот моя подробная профессиональная оценка твоей идеи:\n\n${evaluationResult}`,
        timestamp: Date.now()
      });
    } else {
      initialMessages.push({
        id: "welcome-asst-" + Math.random().toString(36).substr(2, 9),
        role: "assistant",
        content: `Привет! Рада познакомиться. Я твоя творческая Муза. ✨ Я помогу тебе написать книгу **«${newTitle}»**!\n\nОпиши мне своих персонажей, подробности мира или просто поделись сомнениями — и мы вместе сделаем эту историю незабываемой. С чего начнем?`,
        timestamp: Date.now()
      });
    }
    localStorage.setItem(`muse_chat_${storyId}`, JSON.stringify(initialMessages));

    const updatedStories = [...stories, newBook];
    setStories(updatedStories);
    setSelectedStoryId(newBook.id);
    setSelectedChapterId(newBook.chapters[0].id);
    localStorage.setItem("writers_studio_stories", JSON.stringify(updatedStories));

    // Reset Form
    setNewTitle("");
    setNewGenre("Фантастика");
    setNewDesc("");
    setNewWorldBible("");
    setNewBookPlan("");
    setNewBibleFileName("");
    setNewPlanFileName("");
    setIsCreatingStory(false);
    setShowNewStoryModal(false);
    // Keep the current active tab
  };

  // 9. Delete active book
  const handleDeleteStory = () => {
    if (stories.length <= 1) {
      alert("Нельзя удалить единственную книгу!");
      return;
    }

    if (confirm(`Вы уверены, что хотите БЕЗВОЗВРАТНО удалить книгу «${activeStory.title}» со всеми главами, персонажами и заметками?`)) {
      const filtered = stories.filter(s => s.id !== activeStory.id);
      setStories(filtered);
      setSelectedStoryId(filtered[0].id);
      if (filtered[0].chapters && filtered[0].chapters.length > 0) {
        setSelectedChapterId(filtered[0].chapters[0].id);
      }
      localStorage.setItem("writers_studio_stories", JSON.stringify(filtered));
    }
  };

  // 10. Edit active book metadata
  const handleUpdateStoryMetadata = (title: string, genre: string, desc: string, bookPlan?: string, worldBible?: string) => {
    if (!activeStory) return;
    const updatedStory = {
      ...activeStory,
      title,
      genre,
      description: desc,
      bookPlan,
      worldBible,
      updatedAt: Date.now()
    };
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    setShowStoryDetailsModal(false);
  };

  const handleAIGeneratePlan = async () => {
    setIsGeneratingPlan(true);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_plan",
          title: editTitle,
          genre: editGenre,
          description: editDesc,
          bookPlan: editBookPlan,
          worldBible: editWorldBible,
          customPrompt: editCustomPrompt,
          model: selectedModel
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка генерации плана");
      }

      const data = await response.json();
      setEditBookPlan(data.result);
    } catch (err: any) {
      alert(`Ошибка при генерации сюжета: ${err.message}`);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleAIGenerateBible = async () => {
    setIsGeneratingBible(true);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_bible",
          title: editTitle,
          genre: editGenre,
          description: editDesc,
          bookPlan: editBookPlan,
          worldBible: editWorldBible,
          customPrompt: editCustomPrompt,
          model: selectedModel
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Ошибка генерации Библии");
      }

      const data = await response.json();
      setEditWorldBible(data.result);
    } catch (err: any) {
      alert(`Ошибка при генерации Библии мира: ${err.message}`);
    } finally {
      setIsGeneratingBible(false);
    }
  };

  // 10.5. File Import logic
  const readAndSetFile = (file: File) => {
    const isDocx = file.name.endsWith(".docx") || file.name.endsWith(".doc");
    const isTxt = file.name.endsWith(".txt");

    if (!isDocx && !isTxt) {
      alert("Пожалуйста, загрузите файл с расширением .txt или .docx / .doc");
      return;
    }

    if (isDocx) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          setImportFileContent(await extractDocxText(arrayBuffer));
          setImportFileName(file.name);
          const titleWithoutExt = file.name.replace(/\.[^/.]+$/, "");
          setImportFileTitle(titleWithoutExt);
        } catch (err) {
          console.error(err);
          alert("Не удалось прочитать Word-файл. Пожалуйста, убедитесь, что это корректный файл .docx / .doc");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setImportFileContent(text);
        setImportFileName(file.name);
        // Strip extension for title
        const titleWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setImportFileTitle(titleWithoutExt);
      };
      reader.readAsText(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readAndSetFile(file);
    }
  };

  const handleAIParseFile = async () => {
    if (!importFileContent.trim()) return;
    setIsParsingFile(true);
    setParsedResult(null);
    try {
      const response = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "parse_import",
          text: importFileContent,
          model: selectedModel
        })
      });
      if (!response.ok) {
        throw new Error("Не удалось связаться с ИИ-сервером");
      }
      const data = await response.json();
      const parsed = JSON.parse(data.result);
      setParsedResult({
        chapters: parsed.chapters || [],
        characters: parsed.characters || [],
        worldRules: parsed.worldRules || []
      });
    } catch (err: any) {
      console.error(err);
      alert("Ошибка при распознавании файла: " + err.message + ". Пожалуйста, попробуйте еще раз.");
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleExecuteImport = () => {
    if (!activeStory || !importFileContent.trim()) return;

    let updatedStory = { ...activeStory };
    let newSelectedChapterId = selectedChapterId;

    if (importTarget === "auto") {
      if (!parsedResult) {
        alert("Пожалуйста, сначала запустите ИИ-анализ файла!");
        return;
      }
      
      const newChapters = parsedResult.chapters.map(ch => ({
        id: "chapter-" + Math.random().toString(36).substr(2, 9),
        title: ch.title || "Импортированная глава",
        summary: ch.summary || "Распознано ИИ",
        content: ch.content || ""
      }));

      const newCharacters = parsedResult.characters.map(ch => ({
        id: "char-" + Math.random().toString(36).substr(2, 9),
        name: ch.name || "Безымянный персонаж",
        role: ch.role || "Второстепенный",
        traits: ch.traits || "Распознано ИИ",
        goals: ch.goals || "Не указана",
        description: ch.description || ""
      }));

      const newRules = parsedResult.worldRules.map(r => ({
        id: "rule-" + Math.random().toString(36).substr(2, 9),
        title: r.title || "Правило лора",
        content: r.content || ""
      }));

      updatedStory.chapters = [...updatedStory.chapters, ...newChapters];
      updatedStory.characters = [...updatedStory.characters, ...newCharacters];
      updatedStory.worldRules = [...updatedStory.worldRules, ...newRules];

      if (newChapters.length > 0) {
        newSelectedChapterId = newChapters[0].id;
      }
      setActiveTab("muse");
    } else if (importTarget === "chapter") {
      const newCh: Chapter = {
        id: "chapter-" + Math.random().toString(36).substr(2, 9),
        title: importFileTitle || "Импортированная глава",
        summary: "Импортировано из файла " + importFileName,
        content: importFileContent
      };
      updatedStory.chapters = [...updatedStory.chapters, newCh];
      newSelectedChapterId = newCh.id;
    } else if (importTarget === "currentChapter") {
      if (!activeChapter) {
        alert("Нет активной главы для вставки!");
        return;
      }
      updatedStory.chapters = updatedStory.chapters.map(c => 
        c.id === activeChapter.id ? { ...c, content: c.content + (c.content ? "\n\n" : "") + importFileContent } : c
      );
    } else if (importTarget === "worldRule") {
      const newRule: WorldRule = {
        id: "rule-" + Math.random().toString(36).substr(2, 9),
        title: importFileTitle || "Импортированное правило",
        content: importFileContent
      };
      updatedStory.worldRules = [...updatedStory.worldRules, newRule];
      setActiveTab("world");
    } else if (importTarget === "character") {
      const newChar: Character = {
        id: "char-" + Math.random().toString(36).substr(2, 9),
        name: importFileTitle || "Новый персонаж",
        role: "Второстепенный",
        description: importFileContent,
        traits: "Импортировано",
        goals: "Неизвестно"
      };
      updatedStory.characters = [...updatedStory.characters, newChar];
      setActiveTab("characters");
    } else if (importTarget === "bookPlan") {
      updatedStory.bookPlan = importFileContent;
      setActiveTab("ai");
    } else if (importTarget === "worldBible") {
      updatedStory.worldBible = importFileContent;
      setActiveTab("ai");
    }

    updatedStory.updatedAt = Date.now();
    saveAllStories(stories.map(s => s.id === activeStory.id ? updatedStory : s));
    
    if (importTarget === "chapter" || (importTarget === "auto" && parsedResult && parsedResult.chapters.length > 0)) {
      setSelectedChapterId(newSelectedChapterId);
    }

    // Reset and close
    setImportFileContent("");
    setImportFileName("");
    setImportFileTitle("");
    setParsedResult(null);
    setShowImportModal(false);
  };

  // 11. Export as TXT / Word
  const handleExportTxt = () => {
    if (!activeStory) return;
    
    let textOut = `=== КНИГА: ${activeStory.title} ===\nЖанр: ${activeStory.genre}\nОписание: ${activeStory.description}\n\n`;
    
    activeStory.chapters.forEach((ch, idx) => {
      textOut += `\n\n-----------------------------\n${ch.title}\n-----------------------------\n\n${ch.content}\n`;
    });

    // Character listing
    textOut += `\n\n=============================\nПЕРСОНАЖИ\n=============================\n`;
    activeStory.characters.forEach(char => {
      textOut += `\nИмя: ${char.name}\nРоль: ${char.role}\nЧерты: ${char.traits}\nЦель: ${char.goals}\nОписание:\n${char.description}\n`;
    });

    const element = document.createElement("a");
    const file = new Blob([textOut], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = `${activeStory.title}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportDoc = () => {
    if (!activeStory) return;

    let htmlContent = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <title>${activeStory.title}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 1in;
          }
          h1 {
            font-size: 24pt;
            text-align: center;
            margin-bottom: 24pt;
            color: #111111;
          }
          .metadata {
            text-align: center;
            font-style: italic;
            margin-bottom: 48pt;
            font-size: 11pt;
            color: #666666;
            border-bottom: 1px solid #eeeeee;
            padding-bottom: 12pt;
          }
          h2 {
            font-size: 16pt;
            margin-top: 36pt;
            margin-bottom: 12pt;
            border-bottom: 1px solid #cccccc;
            padding-bottom: 6pt;
            color: #1d4ed8;
          }
          p {
            font-size: 12pt;
            text-indent: 0.5in;
            margin-bottom: 12pt;
            text-align: justify;
          }
          .page-break {
            page-break-before: always;
          }
          .lore-title {
            font-size: 14pt;
            font-weight: bold;
            margin-top: 18pt;
            color: #1d4ed8;
          }
          .char-block {
            margin-bottom: 18pt;
            padding: 10pt;
            background-color: #f8fafc;
            border-left: 3pt solid #1d4ed8;
          }
        </style>
      </head>
      <body>
        <h1>${activeStory.title}</h1>
        <div class="metadata">
          <p style="text-indent: 0;"><strong>Жанр:</strong> ${activeStory.genre}</p>
          <p style="text-indent: 0;"><strong>Описание:</strong> ${activeStory.description}</p>
        </div>
    `;

    // Add Chapters
    activeStory.chapters.forEach((ch) => {
      htmlContent += `
        <div class="page-break"></div>
        <h2>${ch.title}</h2>
        <div style="font-style: italic; margin-bottom: 18pt; color: #555555; text-indent: 0;">Синопсис главы: ${ch.summary || "Без описания"}</div>
      `;
      const paras = ch.content.split("\n\n");
      paras.forEach(p => {
        if (p.trim()) {
          htmlContent += `<p>${p.replace(/\n/g, "<br/>")}</p>`;
        }
      });
    });

    // Add Characters
    if (activeStory.characters.length > 0) {
      htmlContent += `
        <div class="page-break"></div>
        <h2>Действующие лица</h2>
      `;
      activeStory.characters.forEach(char => {
        htmlContent += `
          <div class="char-block">
            <strong>Имя:</strong> ${char.name}<br/>
            <strong>Роль:</strong> ${char.role}<br/>
            <strong>Черты:</strong> ${char.traits || "не указаны"}<br/>
            <strong>Цель:</strong> ${char.goals || "не указана"}<br/>
            <strong>Биография:</strong><br/>
            ${char.description.replace(/\n/g, "<br/>")}
          </div>
        `;
      });
    }

    // Add World Lore
    if (activeStory.worldRules.length > 0) {
      htmlContent += `
        <div class="page-break"></div>
        <h2>Правила мира и Лор</h2>
      `;
      activeStory.worldRules.forEach(rule => {
        htmlContent += `
          <div class="lore-title">${rule.title}</div>
          <div style="font-size: 11pt; margin-bottom: 12pt;">${rule.content.replace(/\n/g, "<br/>")}</div>
        `;
      });
    }

    htmlContent += `
      </body>
      </html>
    `;

    const element = document.createElement("a");
    const file = new Blob([htmlContent], { type: "application/msword;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = `${activeStory.title}.doc`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleManualSave = () => {
    setIsSaving(true);
    localStorage.setItem("writers_studio_stories", JSON.stringify(stories));
    setShowSaveSuccess(true);
    setTimeout(() => {
      setIsSaving(false);
      setShowSaveSuccess(false);
    }, 1200);
  };

  const handleExportSingleChapterDoc = (ch: Chapter) => {
    if (!activeStory) return;

    let htmlContent = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <title>${ch.title}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 1in;
          }
          h1 {
            font-size: 22pt;
            text-align: center;
            margin-bottom: 24pt;
            color: #111111;
          }
          .metadata {
            text-align: center;
            font-style: italic;
            margin-bottom: 36pt;
            font-size: 11pt;
            color: #666666;
            border-bottom: 1px solid #eeeeee;
            padding-bottom: 12pt;
          }
          p {
            font-size: 12pt;
            text-indent: 0.5in;
            margin-bottom: 12pt;
            text-align: justify;
          }
        </style>
      </head>
      <body>
        <h1>${activeStory.title}</h1>
        <div class="metadata">
          <p style="text-indent: 0;"><strong>Глава:</strong> ${ch.title}</p>
          <p style="text-indent: 0;"><strong>Синопсис:</strong> ${ch.summary || "Без описания"}</p>
        </div>
    `;

    const paras = ch.content.split("\n\n");
    paras.forEach(p => {
      if (p.trim()) {
        htmlContent += `<p>${p.replace(/\n/g, "<br/>")}</p>`;
      }
    });

    htmlContent += `
      </body>
      </html>
    `;

    const element = document.createElement("a");
    const file = new Blob([htmlContent], { type: "application/msword;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = `${activeStory.title} - ${ch.title}.doc`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Metrics
  const getWordCount = (text: string) => {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  };

  const getCharCount = (text: string) => {
    return text.length;
  };

  const handlePublishChapter = (chapterId: string) => {
    if (!activeStory) return;
    const ch = activeStory.chapters.find(c => c.id === chapterId);
    if (!ch) return;

    const wordCount = getWordCount(ch.content);

    // Update isPublished field of the chapter
    const updatedChapters = activeStory.chapters.map(c => 
      c.id === chapterId ? { ...c, isPublished: true } : c
    );

    const updatedStory = {
      ...activeStory,
      chapters: updatedChapters,
      updatedAt: Date.now()
    };

    const updatedStories = stories.map(s => 
      s.id === activeStory.id ? updatedStory : s
    );

    saveAllStories(updatedStories);
    setPublishedChapterDetails({ title: ch.title, wordCount });
    setShowPublishSuccessModal(true);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0b0f19] text-slate-100 selection:bg-blue-600/30 overflow-hidden" id="main-app-container">
      {/* Top Navigation Panel */}
      <header className="flex justify-between items-center px-5 h-14 bg-[#0e1424] border-b border-slate-800/80 shrink-0 z-10">
        {/* Book Selector Dropdown */}
        <div className="flex items-center gap-3">
          <BookMarked className="w-5 h-5 text-blue-400" />
          <div className="flex items-center gap-1.5">
            <select
              value={selectedStoryId}
              onChange={(e) => {
                const s = stories.find(story => story.id === e.target.value);
                if (s) {
                  setSelectedStoryId(s.id);
                  if (s.chapters && s.chapters.length > 0) {
                    setSelectedChapterId(s.chapters[0].id);
                  }
                }
              }}
              className="bg-slate-900 border border-slate-800 text-slate-100 px-3 py-1 text-sm rounded-lg font-medium outline-none focus:border-blue-500 cursor-pointer"
              id="book-selector"
            >
              {stories.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            
            <button
              onClick={() => setShowStoryDetailsModal(true)}
              title="Редактировать описание книги"
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer transition-colors"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setShowNewStoryModal(true)}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
            id="create-new-book-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Новая книга</span>
          </button>
        </div>

        {/* Sync & Focus status */}
        <div className="flex items-center gap-4">

          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isSaving ? "bg-amber-400 animate-pulse" : "bg-emerald-500"}`} />
            <span>{isSaving ? "Сохранение..." : "Автосохранение включено"}</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFocusMode(!focusMode)}
              className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-xs font-medium border ${
                focusMode 
                  ? "bg-purple-950/40 text-purple-400 border-purple-800" 
                  : "bg-slate-900 border-slate-800 text-slate-300 hover:text-white"
              }`}
              title={focusMode ? "Выйти из режима фокуса" : "Включить режим фокуса (скрыть ИИ)"}
              id="focus-mode-toggle"
            >
              {focusMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span>Режим Фокуса</span>
            </button>

            <button
              onClick={() => setShowImportModal(true)}
              className="p-2 bg-[#10b981]/15 hover:bg-[#10b981]/25 border border-[#10b981]/30 hover:border-[#10b981]/50 text-[#34d399] hover:text-[#6ee7b7] text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              title="Загрузить свой план, библию мира, персонажа или главу из файла .TXT или Word (.docx)"
              id="import-txt-btn"
            >
              <Upload className="w-4 h-4" />
              <span>Импорт .TXT / Word</span>
            </button>

            <button
              onClick={handleExportTxt}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              title="Скачать всю рукопись (.txt)"
              id="export-book-btn"
            >
              <Download className="w-4 h-4" />
              <span>Экспорт .TXT</span>
            </button>

            <button
              onClick={handleExportDoc}
              className="p-2 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 hover:text-blue-300 text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
              title="Скачать всю рукопись с разметкой глав, персонажей и лора в формате Word (.doc)"
              id="export-doc-btn"
            >
              <FileText className="w-4 h-4" />
              <span>Скачать в Word</span>
            </button>

            <button
              onClick={handleDeleteStory}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
              title="Удалить текущую книгу полностью"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <div className="flex flex-1 overflow-hidden w-full relative">
        
        {/* Leftmost Chapter Sidebar */}
        {!focusMode && activeStory && (
          <aside className="w-64 bg-[#0e1424]/60 border-r border-slate-800/80 p-4 flex flex-col shrink-0" id="chapters-sidebar">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/60 mb-3">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-400" />
                Оглавление
              </span>
              <button
                onClick={handleAddChapter}
                className="p-1.5 hover:bg-slate-800 text-slate-200 hover:text-white rounded-lg transition-colors cursor-pointer"
                title="Добавить главу"
                id="add-chapter-btn"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5" id="chapters-list">
              {activeStory.chapters.map((ch, idx) => (
                <div
                  key={ch.id}
                  onClick={() => {
                    setSelectedChapterId(ch.id);
                    setSelectedText("");
                    setTextSelection(null);
                  }}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all group flex justify-between items-center ${
                    selectedChapterId === ch.id
                      ? "bg-blue-600/10 text-blue-400 border-blue-500/40"
                      : "bg-transparent text-slate-300 border-transparent hover:bg-slate-800/40 hover:text-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="text-xs font-medium truncate">{ch.title}</span>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChapter(ch.id);
                    }}
                    className="opacity-70 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1 rounded transition-opacity"
                    title="Удалить главу"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            
            {/* Story Quick Info card */}
            <div className="mt-4 p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
              <span className="text-[10px] text-slate-400 font-bold block mb-1">О ПИСАТЕЛЬСКОМ ИНСТРУМЕНТЕ:</span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Студия Писателя объединяет удобный редактор с мощной языковой моделью. Выделяйте фрагменты в тексте для точечного улучшения стиля, обсуждайте сюжетные дыры с Музой в чате или создавайте персонажей за секунды.
              </p>
            </div>
          </aside>
        )}

        {/* Center Section: The Editor Workspace */}
        <main className="flex-1 flex flex-col bg-[#0b0f19] h-full overflow-hidden relative">
          {activeChapter ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden p-6 max-w-4xl mx-auto w-full">
              
              {/* Chapter Title Edit Block */}
              <div className="mb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800/40 pb-3" id="chapter-title-edit-block">
                <div className="flex-1 space-y-1 w-full">
                  <input
                    type="text"
                    value={activeChapter.title}
                    onChange={(e) => handleUpdateChapterDetails(e.target.value, activeChapter.summary)}
                    placeholder="Заголовок главы..."
                    className="bg-transparent text-slate-100 text-2xl font-bold tracking-tight outline-none w-full pb-0.5"
                  />
                  <input
                    type="text"
                    value={activeChapter.summary}
                    onChange={(e) => handleUpdateChapterDetails(activeChapter.title, e.target.value)}
                    placeholder="Коротко о событиях главы..."
                    className="bg-transparent text-slate-400 text-xs italic outline-none w-full"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleOpenInAuthorEditor(activeChapter.id)}
                    className="px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
                    title="Перенести главу в очеловечиватель «Голос автора»"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>В Голос автора</span>
                  </button>
                  {/* Words metric tag */}
                  <div className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border ${
                    getWordCount(activeChapter.content) >= 1500
                      ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/30"
                      : "bg-slate-950 text-slate-400 border-slate-800"
                  }`} title="Рекомендуемый объём главы">
                    {getWordCount(activeChapter.content)} / 1500 слов
                  </div>

                  {/* Save button */}
                  <button
                    onClick={handleManualSave}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                      showSaveSuccess
                        ? "bg-emerald-950/40 text-emerald-400 border-emerald-900/50"
                        : "bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-850"
                    }`}
                  >
                    <Save className={`w-3.5 h-3.5 ${showSaveSuccess ? "animate-bounce" : ""}`} />
                    <span>{showSaveSuccess ? "Сохранено!" : "Сохранить"}</span>
                  </button>

                  {/* Download as Word button */}
                  <button
                    onClick={() => handleExportSingleChapterDoc(activeChapter)}
                    className="px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Скачать эту главу как Word документ (.doc)"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать в Word</span>
                  </button>
                </div>
              </div>

              {/* Distraction-Free Textarea Editor */}
              <div className="flex-1 bg-slate-900/30 border border-slate-800/60 rounded-xl overflow-hidden flex flex-col relative">
                <textarea
                  ref={textareaRef}
                  value={activeChapter.content}
                  onChange={handleEditorChange}
                  onMouseUp={handleTextSelection}
                  onKeyUp={handleTextSelection}
                  placeholder="Начните писать свой роман здесь... Вы также можете выделить нужный кусок и воспользоваться Редактором Стиля справа."
                  className="flex-1 w-full p-6 text-sm leading-relaxed bg-transparent text-slate-100 outline-none resize-none font-sans scrollbar-thin placeholder:text-slate-600"
                  id="draft-editor-textarea"
                />

                {/* Selection floating helper */}
                {selectedText && (
                  <div className="absolute bottom-12 left-4 px-3 py-1.5 bg-blue-950 border border-blue-900 text-blue-300 text-[11px] font-medium rounded-lg shadow-lg flex items-center gap-2 animate-bounce">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                    <span>Выделено {getWordCount(selectedText)} слов(-а). Перейдите во вкладку «ИИ Помощник» для улучшения.</span>
                  </div>
                )}

                {/* Editor Footer / Metric Counter */}
                <div className="h-9 border-t border-slate-800/60 px-4 bg-slate-950/40 flex justify-between items-center shrink-0 text-xs font-mono text-slate-400">
                  <div className="flex gap-4">
                    <span>Слов: <strong>{getWordCount(activeChapter.content)}</strong></span>
                    <span>Символов: <strong>{getCharCount(activeChapter.content)}</strong></span>
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    UTF-8 • Draft Mode
                  </div>
                </div>
              </div>

              {/* Bottom Quick AI Continuer helper */}
              {!focusMode && (
                <div className="mt-3 flex items-center justify-between p-3 bg-slate-900/40 border border-slate-800/80 rounded-xl shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg">
                      <Sparkle className="w-4 h-4 animate-spin-slow" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200">Достигли тупика в главе?</h4>
                      <p className="text-[10px] text-slate-400">Позвольте ИИ предложить плавное продолжение сцены.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab("ai");
                      // Switch focus to AI continuation
                      setTimeout(() => {
                        const btn = document.getElementById("ai-action-btn");
                        btn?.scrollIntoView({ behavior: "smooth" });
                      }, 100);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    Продолжить ИИ
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <BookOpen className="w-12 h-12 text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm">Главы не обнаружены. Создайте первую главу в боковом оглавлении!</p>
              <button
                onClick={handleAddChapter}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg"
              >
                Добавить главу
              </button>
            </div>
          )}
        </main>

        {/* Right Section: The AI Assistant Suite (Conditionally Hidden in Focus Mode) */}
        {!focusMode && activeStory && (
          <aside className="w-96 bg-[#0e1424]/60 border-l border-slate-800/80 flex flex-col shrink-0" id="assistant-panel">
            {/* Tabs Controller Header */}
            <div className="flex border-b border-slate-800/80 bg-slate-950/50 p-1 gap-1 shrink-0 text-xs font-semibold">
              <button
                onClick={() => setActiveTab("muse")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "muse"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🔮 Муза
              </button>
              <button
                onClick={() => setActiveTab("characters")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "characters"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                👥 Персонажи
              </button>
              <button
                onClick={() => setActiveTab("world")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "world"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🌍 Лор
              </button>
              <button
                onClick={() => setActiveTab("ai")}
                className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer text-center ${
                  activeTab === "ai"
                    ? "bg-slate-800 text-slate-100 font-bold border border-slate-700/50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                ✨ ИИ-Помощник
              </button>
            </div>

            {/* Scrollable Tab Views */}
            <div className="flex-1 overflow-hidden p-4">
              <React.Suspense fallback={<div className="text-slate-500 text-sm p-4">Загрузка…</div>}>
              {activeTab === "muse" && (
                <MuseChat
                  story={activeStory}
                  currentDraft={activeChapter?.content || ""}
                  selectedModel={selectedModel}
                />
              )}
              {activeTab === "characters" && (
                <CharacterManager 
                  story={activeStory} 
                  onUpdateCharacters={handleUpdateCharacters} 
                  selectedModel={selectedModel}
                />
              )}
              {activeTab === "world" && (
                <WorldBuilder 
                  story={activeStory} 
                  onUpdateWorldRules={handleUpdateWorldRules} 
                  selectedModel={selectedModel}
                />
              )}
              {activeTab === "ai" && (
                <AIPanel 
                  story={activeStory} 
                  currentDraft={activeChapter?.content || ""} 
                  selectedText={selectedText}
                  textSelection={textSelection}
                  onInsertText={handleInsertText}
                  onApplyAuthorEdit={handleApplyAuthorEdit}
                  activeChapter={activeChapter}
                  onUpdateStoryChapters={handleUpdateStoryChapters}
                  selectedModel={selectedModel}
                  openAuthorRequest={openAuthorRequest}
                />
              )}
              </React.Suspense>
            </div>
          </aside>
        )}
      </div>

      {/* MODAL 1: Edit Story Details */}
      {showStoryDetailsModal && activeStory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-5 space-y-4 max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <h3 className="font-bold text-base text-slate-100 pb-2 border-b border-slate-800 shrink-0 flex items-center gap-2">
              <Settings className="w-4 h-4 text-blue-400" />
              <span>Описание и материалы книги</span>
            </h3>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateStoryMetadata(
                editTitle,
                editGenre,
                editDesc,
                editBookPlan,
                editWorldBible
              );
            }} className="space-y-4 text-xs flex-1 overflow-y-auto pr-1">
              <div>
                <label className="block text-slate-400 mb-1">Название книги</label>
                <input
                  type="text"
                  name="title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Жанр</label>
                <input
                  type="text"
                  name="genre"
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  placeholder="Фантастика, Фэнтези, Роман..."
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Краткое описание / Синопсис</label>
                <textarea
                  name="desc"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500 font-sans"
                />
              </div>

              {/* Custom Wishes block */}
              <div className="p-3 bg-slate-950 border border-slate-850 rounded-lg space-y-1.5">
                <label className="block text-slate-300 font-bold flex items-center gap-1.5 text-xs">
                  <Wand2 className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                  <span>Пожелания для ИИ при генерации материалов</span>
                </label>
                <input
                  type="text"
                  value={editCustomPrompt}
                  onChange={(e) => setEditCustomPrompt(e.target.value)}
                  placeholder="Пример: Сделай уклон в киберпанк, добавь 10 глав с неожиданной развязкой..."
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-slate-500 block leading-normal">
                  Эти пожелания будут переданы модели Gemini при генерации сюжета или законов мира ниже.
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-slate-400 font-medium text-purple-400">План сюжета (для генерации глав)</label>
                  <button
                    type="button"
                    disabled={isGeneratingPlan || !editTitle}
                    onClick={handleAIGeneratePlan}
                    className="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 hover:text-purple-200 border border-purple-500/30 rounded text-[10px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingPlan ? (
                      <>
                        <div className="w-2.5 h-2.5 border-2 border-purple-300 border-t-transparent rounded-full animate-spin" />
                        <span>Генерация...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        <span>{editBookPlan.trim() ? "Дополнить план с ИИ" : "Сгенерировать план с нуля"}</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  name="bookPlan"
                  value={editBookPlan}
                  onChange={(e) => setEditBookPlan(e.target.value)}
                  placeholder="Загрузите, вставьте или сгенерируйте план развития сюжета по главам..."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-purple-500 font-sans text-[11px]"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-slate-400 font-medium text-blue-400">Библия мира / Сеттинг / Лор</label>
                  <button
                    type="button"
                    disabled={isGeneratingBible || !editTitle}
                    onClick={handleAIGenerateBible}
                    className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-blue-200 border border-blue-500/30 rounded text-[10px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingBible ? (
                      <>
                        <div className="w-2.5 h-2.5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                        <span>Создание лора...</span>
                      </>
                    ) : (
                      <>
                        <Layers className="w-3 h-3 text-blue-400" />
                        <span>{editWorldBible.trim() ? "Дополнить лор с ИИ" : "Разработать лор с ИИ"}</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  name="worldBible"
                  value={editWorldBible}
                  onChange={(e) => setEditWorldBible(e.target.value)}
                  placeholder="Загрузите, вставьте или сгенерируйте правила и лор вашего мира..."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500 font-sans text-[11px]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 text-xs sticky bottom-0 bg-slate-900 pb-1">
                <button
                  type="button"
                  onClick={() => setShowStoryDetailsModal(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Create New Book */}
      {showNewStoryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-500 text-white rounded-xl shadow-lg">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-100">Создать новую книгу</h3>
                  <p className="text-xs text-slate-400">Начните новую историю и загрузите материалы для оценки Музой</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isCreatingStory) {
                    setShowNewStoryModal(false);
                    setNewTitle("");
                    setNewWorldBible("");
                    setNewBookPlan("");
                    setNewBibleFileName("");
                    setNewPlanFileName("");
                  }
                }}
                disabled={isCreatingStory}
                className="text-slate-400 hover:text-slate-200 text-lg p-1 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors disabled:opacity-30"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {isCreatingStory ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-4">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                    <Sparkles className="w-6 h-6 text-purple-400 absolute inset-0 m-auto animate-bounce" />
                  </div>
                  <div className="text-center space-y-2">
                    <h4 className="text-base font-bold text-purple-400">Муза погружается в вашу книгу...</h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                      Мы анализируем вашу новую Библию мира и План сюжета. ИИ сопоставляет правила сеттинга с поглавным развитием истории, ищет логические противоречия и готовит вдохновляющие советы для успешного старта.
                    </p>
                    <span className="text-[10px] text-slate-500 font-mono">Это может занять 10-15 секунд</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                  {/* Left Column: Basic Info */}
                  <div className="space-y-4 flex flex-col">
                    <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4 flex-1">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Основная информация</h4>
                      
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Название книги</label>
                        <input
                          type="text"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder="Введите название..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 outline-none focus:border-blue-500 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Жанр</label>
                        <input
                          type="text"
                          value={newGenre}
                          onChange={(e) => setNewGenre(e.target.value)}
                          placeholder="Например: Фэнтези, Детектив, Роман"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 outline-none focus:border-blue-500 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Краткий синопсис / Идея</label>
                        <textarea
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          placeholder="О чем будет книга? Краткое описание поможет Музе лучше ориентироваться."
                          rows={6}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 outline-none focus:border-blue-500 font-sans text-xs resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Files & Materials */}
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkle className="w-3.5 h-3.5 text-purple-400" />
                        Материалы для ИИ-оценки Музы
                      </h4>

                      {/* World Bible file and text */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-slate-400 font-medium">Библия мира (Сеттинг / Правила лора)</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            id="new-bible-file"
                            accept=".txt,.docx,.doc"
                            onChange={handleNewBibleFileChange}
                            className="hidden"
                          />
                          <label
                            htmlFor="new-bible-file"
                            className="flex-1 py-1.5 px-3 border border-dashed border-slate-800 hover:border-blue-500/50 bg-slate-950/60 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span className="truncate">{newBibleFileName ? `✓ ${newBibleFileName}` : "Загрузить .TXT/.DOCX"}</span>
                          </label>
                          {newBibleFileName && (
                            <button
                              onClick={() => {
                                setNewWorldBible("");
                                setNewBibleFileName("");
                              }}
                              className="text-red-400 hover:text-red-300 px-2 py-1 bg-red-950/20 border border-red-900/30 rounded-lg"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <textarea
                          value={newWorldBible}
                          onChange={(e) => setNewWorldBible(e.target.value)}
                          placeholder="Или вставьте правила сеттинга, законы магии, информацию о фракциях сюда..."
                          rows={3}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 outline-none focus:border-blue-500 font-sans text-[11px] resize-none"
                        />
                      </div>

                      {/* Book Plan file and text */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="block text-slate-400 font-medium">План книги (Оглавление / Сюжетные арки)</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            id="new-plan-file"
                            accept=".txt,.docx,.doc"
                            onChange={handleNewPlanFileChange}
                            className="hidden"
                          />
                          <label
                            htmlFor="new-plan-file"
                            className="flex-1 py-1.5 px-3 border border-dashed border-slate-800 hover:border-purple-500/50 bg-slate-950/60 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer text-center flex items-center justify-center gap-1.5 transition-all"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span className="truncate">{newPlanFileName ? `✓ ${newPlanFileName}` : "Загрузить .TXT/.DOCX"}</span>
                          </label>
                          {newPlanFileName && (
                            <button
                              onClick={() => {
                                setNewBookPlan("");
                                setNewPlanFileName("");
                              }}
                              className="text-red-400 hover:text-red-300 px-2 py-1 bg-red-950/20 border border-red-900/30 rounded-lg"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <textarea
                          value={newBookPlan}
                          onChange={(e) => setNewBookPlan(e.target.value)}
                          placeholder="Или вставьте поглавный синопсис, сюжетный набросок, арки героев сюда..."
                          rows={3}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 outline-none focus:border-purple-500 font-sans text-[11px] resize-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {creationError && (
                <div className="p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-lg mt-4 text-xs">
                  {creationError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!isCreatingStory && (
              <div className="p-4 border-t border-slate-800 bg-slate-950/30 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewStoryModal(false);
                    setNewTitle("");
                    setNewWorldBible("");
                    setNewBookPlan("");
                    setNewBibleFileName("");
                    setNewPlanFileName("");
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleCreateNewStory}
                  disabled={!newTitle.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
                >
                  {(newWorldBible.trim() || newBookPlan.trim()) ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-pulse" />
                      <span>Создать и оценить Музой</span>
                    </>
                  ) : (
                    <span>Создать книгу</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 3: Import TXT/Word/Plan File */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-400" />
                Импорт файлов .TXT / Word (.docx, .doc)
              </h3>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportFileContent("");
                  setImportFileName("");
                  setImportFileTitle("");
                  setParsedResult(null);
                }}
                className="text-slate-400 hover:text-slate-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Загрузите текстовый файл (.txt) или документ Word (.docx, .doc) с планом вашей книги, деталями персонажей, описанием мира (библией) или готовой главой. Вы сможете выбрать, в какой раздел его сохранить.
            </p>

            {/* Drag & Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                isDragging
                  ? "border-emerald-500 bg-[#10b981]/10 text-emerald-300"
                  : importFileContent
                  ? "border-slate-700 bg-slate-950/40 text-slate-300"
                  : "border-slate-800 hover:border-slate-700 bg-slate-950/20 text-slate-400"
              }`}
            >
              <input
                type="file"
                id="file-import-input"
                accept=".txt,.docx,.doc"
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="file-import-input" className="cursor-pointer block space-y-2">
                <Upload className="w-8 h-8 mx-auto opacity-70" />
                <div className="text-xs font-medium">
                  {importFileName ? (
                    <span className="text-emerald-400 font-semibold">✓ Файл выбран: {importFileName}</span>
                  ) : (
                    <span>Перетащите файл .TXT или .DOCX сюда или <span className="text-blue-400 underline cursor-pointer">выберите на диске</span></span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500">Поддерживаются файлы TXT, DOCX и DOC любого размера</div>
              </label>
            </div>

            {importFileContent && (
              <div className="space-y-3.5 text-xs">
                {/* Destination Selector */}
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Куда импортировать данные?</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setImportTarget("chapter")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "chapter"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Новая глава</div>
                      <div className="text-[10px] opacity-70">Создать новую главу</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("currentChapter")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "currentChapter"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">В текущую главу</div>
                      <div className="text-[10px] opacity-70">Дописать в конец активной</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("worldRule")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "worldRule"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Лор / Правило мира</div>
                      <div className="text-[10px] opacity-70">Добавить в Библию мира</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("character")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "character"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Персонаж</div>
                      <div className="text-[10px] opacity-70">Новый герой с описанием</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("bookPlan")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "bookPlan"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">План сюжета (Книги)</div>
                      <div className="text-[10px] opacity-70">Импортировать в план книги</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("worldBible")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        importTarget === "worldBible"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold">Библия мира / Лор</div>
                      <div className="text-[10px] opacity-70">Импортировать в Библию мира</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setImportTarget("auto")}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer col-span-2 ${
                        importTarget === "auto"
                          ? "border-purple-500 bg-purple-500/10 text-purple-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-300"
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        Умное ИИ-распределение
                      </div>
                      <div className="text-[10px] opacity-70">Автоматически разобрать файл на главы, персонажей и лор</div>
                    </button>
                  </div>
                </div>

                {/* Name / Title */}
                {importTarget !== "currentChapter" && importTarget !== "auto" && importTarget !== "bookPlan" && importTarget !== "worldBible" && (
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">
                      {importTarget === "character" ? "Имя персонажа" : "Название элемента"}
                    </label>
                    <input
                      type="text"
                      value={importFileTitle}
                      onChange={(e) => setImportFileTitle(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-100 outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* AI Automatic parsing container */}
                {importTarget === "auto" && (
                  <div className="bg-slate-950/60 p-3 rounded-lg border border-purple-900/40 space-y-3">
                    <div className="flex items-center gap-2 text-purple-400 font-medium text-xs">
                      <Sparkles className="w-4 h-4" />
                      <span>Умный анализ и авто-разделение ИИ</span>
                    </div>

                    {!parsedResult && !isParsingFile && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-400 leading-normal">
                          ИИ автоматически просканирует весь текст, найдет в нем новые главы, детальные описания героев и лор вселенной, и мгновенно распределит их по соответствующим разделам приложения.
                        </p>
                        <button
                          type="button"
                          onClick={handleAIParseFile}
                          className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Wand2 className="w-4 h-4" />
                          Начать ИИ-анализ файла
                        </button>
                      </div>
                    )}

                    {isParsingFile && (
                      <div className="py-4 text-center space-y-2 animate-pulse">
                        <div className="inline-block w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-[11px] text-purple-400 font-medium">
                          Анализируем рукопись... Выделяем главы, персонажей и лор...
                        </p>
                      </div>
                    )}

                    {parsedResult && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                          ✓ Анализ завершен! Найдено элементов:
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <div className="font-bold text-slate-300">Главы ({parsedResult.chapters.length})</div>
                            <div className="text-[9px] text-slate-500 mt-1 max-h-16 overflow-y-auto space-y-0.5">
                              {parsedResult.chapters.map((ch, i) => (
                                <div key={i} className="truncate">• {ch.title}</div>
                              ))}
                              {parsedResult.chapters.length === 0 && <div className="italic">Не найдено</div>}
                            </div>
                          </div>

                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <div className="font-bold text-slate-300">Персонажи ({parsedResult.characters.length})</div>
                            <div className="text-[9px] text-slate-500 mt-1 max-h-16 overflow-y-auto space-y-0.5">
                              {parsedResult.characters.map((ch, i) => (
                                <div key={i} className="truncate">• {ch.name}</div>
                              ))}
                              {parsedResult.characters.length === 0 && <div className="italic">Не найдено</div>}
                            </div>
                          </div>

                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <div className="font-bold text-slate-300">Лор мира ({parsedResult.worldRules.length})</div>
                            <div className="text-[9px] text-slate-500 mt-1 max-h-16 overflow-y-auto space-y-0.5">
                              {parsedResult.worldRules.map((r, i) => (
                                <div key={i} className="truncate">• {r.title}</div>
                              ))}
                              {parsedResult.worldRules.length === 0 && <div className="italic">Не найдено</div>}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleAIParseFile}
                          className="w-full py-1 text-[10px] text-slate-400 hover:text-slate-300 underline text-center cursor-pointer"
                        >
                          Запустить анализ заново
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Text preview */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Предпросмотр контента</label>
                  <div className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 max-h-24 overflow-y-auto font-mono text-[11px] leading-relaxed select-none">
                    {importFileContent.length > 500
                      ? importFileContent.substring(0, 500) + "..."
                      : importFileContent}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportFileContent("");
                  setImportFileName("");
                  setImportFileTitle("");
                  setParsedResult(null);
                }}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={!importFileContent.trim() || (importTarget === "auto" && !parsedResult) || isParsingFile}
                className={`px-4 py-1.5 disabled:opacity-50 text-white font-medium rounded cursor-pointer flex items-center gap-1.5 transition-all ${
                  importTarget === "auto"
                    ? "bg-purple-600 hover:bg-purple-500"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                <span>
                  {importTarget === "auto" ? "Интегрировать ИИ данные" : "Импортировать"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Celebration Publish Success Modal */}
      {showPublishSuccessModal && publishedChapterDetails && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all animate-fade-in" id="publish-success-modal">
          <div className="bg-[#0e1424] border border-emerald-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden space-y-4">
            
            {/* Elegant light ray backdrops */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="text-center space-y-3 relative z-10">
              <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/5 animate-bounce">
                <Globe className="w-8 h-8" />
              </div>
              
              <h3 className="text-xl font-extrabold text-white tracking-tight">
                Глава успешно опубликована! 🎉
              </h3>
              
              <p className="text-xs text-slate-300 leading-relaxed px-2">
                Поздравляем автора! Ваша глава <strong className="text-emerald-400">«{publishedChapterDetails.title}»</strong> ({publishedChapterDetails.wordCount} слов) успешно подготовлена к выпуску и опубликована на нашей самиздат-платформе.
              </p>
            </div>

            {/* Word count target check */}
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2 relative z-10">
              <div className="flex justify-between items-center text-xs text-slate-400">
                <span>Объём главы</span>
                <span className="font-semibold font-mono text-slate-200">
                  {publishedChapterDetails.wordCount} / 1500 слов
                </span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    publishedChapterDetails.wordCount >= 1500 ? "bg-emerald-500" : "bg-amber-500"
                  }`} 
                  style={{ width: `${Math.min(100, (publishedChapterDetails.wordCount / 1500) * 100)}%` }}
                />
              </div>
              {publishedChapterDetails.wordCount >= 1500 ? (
                <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Отличная работа! Целевой объём в 1500 слов выполнен.
                </p>
              ) : (
                <p className="text-[10px] text-amber-400 leading-normal">
                  ⚠ Рекомендуемый объем главы 1500 слов. Вы можете продолжить расширять главу с Музой для идеального баланса сюжета.
                </p>
              )}
            </div>

            <div className="flex justify-center pt-2 relative z-10">
              <button
                onClick={() => setShowPublishSuccessModal(false)}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-500/10 active:scale-98 text-xs"
              >
                Вернуться к творчеству
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
