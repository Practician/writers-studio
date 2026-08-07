import { AuthorProfileRecord, AuthorRevisionRecord, AgentHistoryEntry, CodexEntry } from "../types";

const DB_NAME = "writers-studio-author-editor";
const DB_VERSION = 3;
const PROFILES = "profiles";
const REVISIONS = "revisions";
const AGENT_EPISODES = "agent_episodes";
const DEEP_PROFILES = "deep_profiles";
const PROJECT_CODEX = "project_codex";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        if (!database.objectStoreNames.contains(PROFILES)) {
          database.createObjectStore(PROFILES, { keyPath: "storyId" });
        }
        if (!database.objectStoreNames.contains(REVISIONS)) {
          const store = database.createObjectStore(REVISIONS, { keyPath: "id" });
          store.createIndex("byChapter", "storyChapterKey", { unique: false });
        }
      }
      if (oldVersion < 2) {
        if (!database.objectStoreNames.contains(AGENT_EPISODES)) {
          const episodeStore = database.createObjectStore(AGENT_EPISODES, { keyPath: "id" });
          episodeStore.createIndex("byStory", "storyId", { unique: false });
          episodeStore.createIndex("byTimestamp", "timestamp", { unique: false });
        }
        if (!database.objectStoreNames.contains(DEEP_PROFILES)) {
          database.createObjectStore(DEEP_PROFILES, { keyPath: "storyId" });
        }
      }
      if (oldVersion < 3) {
        if (!database.objectStoreNames.contains(PROJECT_CODEX)) {
          const codexStore = database.createObjectStore(PROJECT_CODEX, { keyPath: "id" });
          codexStore.createIndex("byStory", "storyId", { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть локальное хранилище"));
  });
}


function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Ошибка локального хранилища"));
  });
}

const PROFILE_UPDATED_EVENT = "writers-studio-author-profile-updated";

/** Уведомить другие панели (ИИ-Помощник), что образец/паспорт изменился. */
export function notifyAuthorProfileUpdated(storyId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: { storyId } }));
}

export function onAuthorProfileUpdated(handler: (storyId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const storyId = (event as CustomEvent<{ storyId?: string }>).detail?.storyId;
    if (storyId) handler(storyId);
  };
  window.addEventListener(PROFILE_UPDATED_EVENT, listener);
  return () => window.removeEventListener(PROFILE_UPDATED_EVENT, listener);
}

export async function loadAuthorProfile(storyId: string): Promise<AuthorProfileRecord | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROFILES, "readonly");
    return await requestResult(transaction.objectStore(PROFILES).get(storyId));
  } finally {
    database.close();
  }
}

export async function saveAuthorProfile(profile: AuthorProfileRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROFILES, "readwrite");
    await requestResult(transaction.objectStore(PROFILES).put(profile));
  } finally {
    database.close();
  }
  notifyAuthorProfileUpdated(profile.storyId);
}

export async function deleteAuthorProfile(storyId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(PROFILES, "readwrite").objectStore(PROFILES).delete(storyId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  notifyAuthorProfileUpdated(storyId);
}

export async function saveAuthorRevision(revision: AuthorRevisionRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REVISIONS, "readwrite");
    await requestResult(transaction.objectStore(REVISIONS).put(revision));
  } finally {
    database.close();
  }
}

export async function listAuthorRevisions(storyId: string, chapterId: string): Promise<AuthorRevisionRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(REVISIONS, "readonly");
    const index = transaction.objectStore(REVISIONS).index("byChapter");
    const records = await requestResult(index.getAll(`${storyId}:${chapterId}`));
    return records.sort((left, right) => right.createdAt - left.createdAt);
  } finally {
    database.close();
  }
}

// ─── ИИ-Агент: эпизоды и глубокие профили ────────────────────────────

export async function saveAgentEpisode(episode: AgentHistoryEntry): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(AGENT_EPISODES, "readwrite");
    await requestResult(transaction.objectStore(AGENT_EPISODES).put(episode));
  } finally {
    database.close();
  }
}

export async function listAgentEpisodes(storyId: string): Promise<AgentHistoryEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(AGENT_EPISODES, "readonly");
    const index = transaction.objectStore(AGENT_EPISODES).index("byStory");
    const records = await requestResult(index.getAll(storyId));
    return records.sort((left: AgentHistoryEntry, right: AgentHistoryEntry) => right.timestamp - left.timestamp);
  } finally {
    database.close();
  }
}

export async function saveDeepProfile(storyId: string, profile: unknown): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DEEP_PROFILES, "readwrite");
    await requestResult(transaction.objectStore(DEEP_PROFILES).put({ storyId, profile, updatedAt: Date.now() }));
  } finally {
    database.close();
  }
}

export async function loadDeepProfile(storyId: string): Promise<unknown | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DEEP_PROFILES, "readonly");
    const record = await requestResult(transaction.objectStore(DEEP_PROFILES).get(storyId));
    return record?.profile;
  } finally {
    database.close();
  }
}

// ─── Codex ─────────────────────────────────────────────────────────────

export async function saveCodexEntry(entry: CodexEntry): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_CODEX, "readwrite");
    await requestResult(transaction.objectStore(PROJECT_CODEX).put(entry));
  } finally {
    database.close();
  }
}

export async function listCodexEntries(storyId: string): Promise<CodexEntry[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_CODEX, "readonly");
    const index = transaction.objectStore(PROJECT_CODEX).index("byStory");
    const records = await requestResult(index.getAll(storyId));
    return records.sort((left: CodexEntry, right: CodexEntry) => right.updatedAt - left.updatedAt);
  } finally {
    database.close();
  }
}

export async function deleteCodexEntry(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(PROJECT_CODEX, "readwrite").objectStore(PROJECT_CODEX).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
