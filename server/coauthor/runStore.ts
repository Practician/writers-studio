import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import type {
  Changeset,
  CoauthorCheckpoint,
  CoauthorEvent,
  CoauthorPlanStep,
  CoauthorRun,
  CoauthorRunStatus,
  QualityReport,
} from "../../src/lib/coauthorContracts";

interface RunStoreFile {
  version: 1;
  runs: CoauthorRun[];
}

export class CoauthorRunStore {
  private readonly runs = new Map<string, CoauthorRun>();
  private readonly emitter = new EventEmitter();

  constructor(private readonly filePath = path.resolve(process.cwd(), "data", "coauthor-runs.json")) {
    this.load();
  }

  create(run: CoauthorRun): CoauthorRun {
    this.runs.set(run.id, run);
    this.persist();
    this.emit(run.id, { type: "state", status: run.status, message: "Задача Соавтора создана" });
    return run;
  }

  get(runId: string): CoauthorRun | undefined {
    return this.runs.get(runId);
  }

  listByStory(storyId: string, limit = 20): CoauthorRun[] {
    return Array.from(this.runs.values())
      .filter((run) => run.context.storyId === storyId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, limit));
  }

  subscribe(runId: string, listener: (event: CoauthorEvent) => void): () => void {
    const key = `run:${runId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  setStatus(runId: string, status: CoauthorRunStatus, message: string): CoauthorRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.status = status;
    run.updatedAt = new Date().toISOString();
    this.persist();
    this.emit(runId, { type: "state", status, message });
    return run;
  }

  addCheckpoint(runId: string, title: string, message: string): CoauthorRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const checkpoint: CoauthorCheckpoint = {
      id: `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      title,
      message,
      status: run.status,
    };
    run.checkpoints.push(checkpoint);
    run.updatedAt = checkpoint.createdAt;
    this.persist();
    this.emit(runId, { type: "checkpoint", title, message });
    return run;
  }

  updatePlan(runId: string, plan: CoauthorPlanStep[]): CoauthorRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.plan = plan;
    run.updatedAt = new Date().toISOString();
    this.persist();
    return run;
  }

  complete(runId: string, output: string, quality?: QualityReport, changeset?: Changeset): CoauthorRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.output = output;
    run.quality = quality;
    run.changeset = changeset;
    run.status = changeset ? "awaiting_approval" : "completed";
    run.updatedAt = new Date().toISOString();
    this.persist();
    if (changeset && quality) this.emit(runId, { type: "changeset_ready", changeset, quality });
    this.emit(runId, {
      type: "state",
      status: run.status,
      message: changeset ? "Изменения готовы к просмотру и подтверждению" : "Задача Соавтора завершена",
    });
    return run;
  }

  fail(runId: string, error: string): CoauthorRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.error = error;
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    this.persist();
    this.emit(runId, { type: "state", status: "failed", message: error });
    return run;
  }

  cancel(runId: string): CoauthorRun | undefined {
    return this.setStatus(runId, "cancelled", "Задача остановлена автором");
  }

  setFeedback(runId: string, decision: "accepted" | "rejected" | "edited", note?: string): CoauthorRun | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.feedback = { decision, note: note?.slice(0, 2_000), createdAt: new Date().toISOString() };
    run.updatedAt = run.feedback.createdAt;
    this.persist();
    this.addCheckpoint(runId, "Обратная связь автора", decision === "accepted" ? "Результат принят" : decision === "edited" ? "Результат принят с ручными правками" : "Результат отклонён");
    return run;
  }

  private emit(runId: string, event: CoauthorEvent): void {
    this.emitter.emit(`run:${runId}`, event);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as RunStoreFile;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.runs)) return;
      for (const run of parsed.runs) this.runs.set(run.id, run);
    } catch (error) {
      console.warn("Coauthor run store could not be loaded:", error);
    }
  }

  private persist(): void {
    const payload: RunStoreFile = { version: 1, runs: Array.from(this.runs.values()) };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      console.warn("Coauthor run store could not be saved:", error);
    }
  }
}
