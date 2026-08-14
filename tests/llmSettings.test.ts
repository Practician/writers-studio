import test from "node:test";
import assert from "node:assert/strict";
import { loadLlmKeys, saveLlmKeys } from "../src/lib/llmSettings";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("saving one visible provider key preserves previously saved NVIDIA key", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

  try {
    storage.setItem("writers_studio_llm_keys_v1", JSON.stringify({
      gemini: "gem-old",
      nvidia: "nvapi-retained",
      groq: "",
      openrouter: "",
    }));

    const loaded = loadLlmKeys();
    assert.equal(loaded.nvidia, "nvapi-retained");

    saveLlmKeys({ ...loaded, gemini: "gem-updated" });
    const afterSave = loadLlmKeys();
    assert.equal(afterSave.gemini, "gem-updated");
    assert.equal(afterSave.nvidia, "nvapi-retained");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
