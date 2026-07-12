import { AuthorProfileRecord, AuthorRevisionRecord } from "../types";

const DB_NAME = "writers-studio-author-editor";
const DB_VERSION = 1;
const PROFILES = "profiles";
const REVISIONS = "revisions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROFILES)) {
        database.createObjectStore(PROFILES, { keyPath: "storyId" });
      }
      if (!database.objectStoreNames.contains(REVISIONS)) {
        const store = database.createObjectStore(REVISIONS, { keyPath: "id" });
        store.createIndex("byChapter", "storyChapterKey", { unique: false });
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
}

export async function deleteAuthorProfile(storyId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(PROFILES, "readwrite").objectStore(PROFILES).delete(storyId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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
