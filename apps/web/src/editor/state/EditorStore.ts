import { useSyncExternalStore } from "react";
import type { CanonicalGameState, EntityRecord } from "digipology-kernel";
import type { ReleaseBundleDto } from "digipology-protocol/http";

import { rebuildDraftIntegrity } from "./bundle";
import { AUTO_SAVE_DEBOUNCE_MS, MAX_HISTORY_ENTRIES, MAX_LOG_ENTRIES } from "./constants";
import * as ComponentActions from "./actions/components";
import * as EntityActions from "./actions/entities";
import { createHistoryFrame } from "./actions/history";
import { createScript, deleteScript, renameScript, scriptContent, scriptFiles, updateScript } from "./scripts";
import type {
  EditorDraft,
  EditorLogEntry,
  EditorSnapshot,
  HistoryFrame,
} from "./types";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface EditorStoreOptions {
  saveDraft?: (draft: EditorDraft) => void;
  now?: () => string;
  defer?: (callback: () => void) => void;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

function defaultDefer(callback: () => void): void {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else setTimeout(callback, 0);
}

function state(draft: EditorDraft): CanonicalGameState {
  return draft.bundle.initialSnapshot.state as CanonicalGameState;
}

export function useEditorSnapshot(store: EditorStore): EditorSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export class EditorStore {
  private readonly listeners = new Set<() => void>();
  private readonly saveDraft: (draft: EditorDraft) => void;
  private readonly now: () => string;
  private readonly defer: (callback: () => void) => void;
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private draft: EditorDraft;
  private selectedEntityId: string | null = null;
  private selectedScriptPath: string | null;
  private past: HistoryFrame[] = [];
  private future: HistoryFrame[] = [];
  private logs: EditorLogEntry[] = [];
  private revision = 0;
  private logId = 0;
  private saveStatus: EditorSnapshot["saveStatus"] = "saved";
  private autoSaveTimer: TimerHandle | null = null;
  private saveScheduleRevision = 0;
  private disposed = false;
  private coalesced: { frame: HistoryFrame; label: string; mutated: boolean } | null = null;
  private snapshot: EditorSnapshot;

  constructor(draft: EditorDraft, options: EditorStoreOptions = {}) {
    this.draft = structuredClone(draft);
    rebuildDraftIntegrity(this.draft);
    this.selectedScriptPath = scriptFiles(this.draft.bundle)[0]?.path ?? null;
    this.saveDraft = options.saveDraft ?? (() => undefined);
    this.now = options.now ?? (() => new Date().toISOString());
    this.defer = options.defer ?? defaultDefer;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.appendLog("Draft loaded.");
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSnapshot => this.snapshot;

  private buildSnapshot(): EditorSnapshot {
    const entities = state(this.draft).entities;
    return {
      draft: this.draft,
      bundle: this.draft.bundle,
      entities,
      selectedEntityId: this.selectedEntityId,
      selectedEntity: this.selectedEntityId === null ? null : entities[this.selectedEntityId] ?? null,
      selectedScriptPath: this.selectedScriptPath,
      past: this.past,
      future: this.future,
      logs: this.logs,
      revision: this.revision,
      saveStatus: this.saveStatus,
    };
  }

  private publish(scheduleSave: boolean): void {
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
    if (scheduleSave) this.scheduleAutoSave();
  }

  private appendLog(message: string, level: EditorLogEntry["level"] = "info"): void {
    this.logs = [...this.logs, {
      id: this.logId,
      level,
      message,
      timestamp: this.now(),
    }].slice(-MAX_LOG_ENTRIES);
    this.logId += 1;
  }

  log(message: string, level: EditorLogEntry["level"] = "info"): void {
    this.appendLog(message, level);
    this.publish(false);
  }

  selectEntity(entityId: string | null): void {
    this.selectedEntityId = entityId !== null && state(this.draft).entities[entityId] !== undefined
      ? entityId
      : null;
    this.publish(false);
  }

  selectScript(path: string | null): void {
    this.selectedScriptPath = path !== null && scriptContent(this.draft, path) !== null ? path : null;
    this.publish(false);
  }

  createScript(name: string, content = ""): boolean {
    let path: string | null = null;
    const ok = this.applySceneCommand(`Created script ${name}`, (draft) => {
      path = createScript(draft, name, content);
    });
    if (ok) {
      this.selectedScriptPath = path;
      this.publish(false);
    }
    return ok;
  }

  renameSelectedScript(name: string): boolean {
    const current = this.selectedScriptPath;
    if (current === null) return false;
    let path: string | null = null;
    const ok = this.applySceneCommand(`Renamed script ${current}`, (draft) => {
      path = renameScript(draft, current, name);
    });
    if (ok) {
      this.selectedScriptPath = path;
      this.publish(false);
    }
    return ok;
  }

  deleteSelectedScript(): boolean {
    const current = this.selectedScriptPath;
    if (current === null) return false;
    const ok = this.applySceneCommand(`Deleted script ${current}`, (draft) => deleteScript(draft, current));
    if (ok) {
      this.selectedScriptPath = scriptFiles(this.draft.bundle)[0]?.path ?? null;
      this.publish(false);
    }
    return ok;
  }

  updateSelectedScript(content: string, label = "Edited script"): boolean {
    const current = this.selectedScriptPath;
    if (current === null || scriptContent(this.draft, current) === content) return false;
    return this.applySceneCommand(`${label} ${current}`, (draft) => updateScript(draft, current, content));
  }

  applySceneCommand(label: string, mutate: (draft: EditorDraft) => void): boolean {
    if (this.coalesced !== null) this.endCoalescedSceneCommand();
    const previous = createHistoryFrame(this.draft, this.selectedEntityId, label, this.now());
    const candidate = structuredClone(this.draft);
    try {
      mutate(candidate);
      candidate.updatedAt = this.now();
      rebuildDraftIntegrity(candidate);
    } catch (error) {
      this.appendLog(error instanceof Error ? error.message : String(error), "error");
      this.publish(false);
      return false;
    }
    this.draft = candidate;
    if (this.selectedEntityId !== null && state(candidate).entities[this.selectedEntityId] === undefined) {
      this.selectedEntityId = null;
    }
    if (this.selectedScriptPath !== null && scriptContent(candidate, this.selectedScriptPath) === null) {
      this.selectedScriptPath = scriptFiles(candidate.bundle)[0]?.path ?? null;
    }
    this.past = [...this.past, previous].slice(-MAX_HISTORY_ENTRIES);
    this.future = [];
    this.saveStatus = "saving";
    this.appendLog(label);
    this.publish(true);
    return true;
  }

  beginCoalescedSceneCommand(label: string): void {
    if (this.coalesced !== null) return;
    this.coalesced = {
      label,
      frame: createHistoryFrame(this.draft, this.selectedEntityId, label, this.now()),
      mutated: false,
    };
  }

  mutateDuringCoalescedSceneCommand(mutate: (draft: EditorDraft) => void): boolean {
    if (this.coalesced === null) throw new Error("No coalesced command is active.");
    const candidate = structuredClone(this.draft);
    try {
      mutate(candidate);
      candidate.updatedAt = this.now();
      rebuildDraftIntegrity(candidate);
    } catch (error) {
      this.appendLog(error instanceof Error ? error.message : String(error), "error");
      this.publish(false);
      return false;
    }
    this.draft = candidate;
    this.coalesced.mutated = true;
    this.saveStatus = "saving";
    this.publish(false);
    return true;
  }

  endCoalescedSceneCommand(finalLabel?: string): void {
    const command = this.coalesced;
    this.coalesced = null;
    if (command === null || !command.mutated) return;
    this.past = [...this.past, command.frame].slice(-MAX_HISTORY_ENTRIES);
    this.future = [];
    this.appendLog(finalLabel ?? command.label);
    this.publish(true);
  }

  commitCoalescedSceneCommand(finalLabel?: string): void {
    this.endCoalescedSceneCommand(finalLabel);
  }

  isCoalescedSceneCommandActive(): boolean {
    return this.coalesced !== null;
  }

  undo(): void {
    const frame = this.past.at(-1);
    if (frame === undefined) return;
    const current = createHistoryFrame(this.draft, this.selectedEntityId, frame.label, this.now());
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, current].slice(-MAX_HISTORY_ENTRIES);
    this.draft = structuredClone(frame.draft);
    this.selectedEntityId = frame.selectedEntityId;
    if (this.selectedScriptPath !== null && scriptContent(this.draft, this.selectedScriptPath) === null) {
      this.selectedScriptPath = scriptFiles(this.draft.bundle)[0]?.path ?? null;
    }
    this.saveStatus = "saving";
    this.appendLog(`Undid ${frame.label}`);
    this.publish(true);
  }

  redo(): void {
    const frame = this.future.at(-1);
    if (frame === undefined) return;
    const current = createHistoryFrame(this.draft, this.selectedEntityId, frame.label, this.now());
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, current].slice(-MAX_HISTORY_ENTRIES);
    this.draft = structuredClone(frame.draft);
    this.selectedEntityId = frame.selectedEntityId;
    if (this.selectedScriptPath !== null && scriptContent(this.draft, this.selectedScriptPath) === null) {
      this.selectedScriptPath = scriptFiles(this.draft.bundle)[0]?.path ?? null;
    }
    this.saveStatus = "saving";
    this.appendLog(`Redid ${frame.label}`);
    this.publish(true);
  }

  jumpToHistory(index: number): void {
    const targetLength = Math.max(0, Math.min(this.past.length, index + 1));
    while (this.past.length > targetLength) this.undo();
  }

  replaceDraft(draft: EditorDraft, reason = "Draft imported."): void {
    this.draft = structuredClone(draft);
    rebuildDraftIntegrity(this.draft);
    this.selectedEntityId = null;
    this.selectedScriptPath = scriptFiles(this.draft.bundle)[0]?.path ?? null;
    this.past = [];
    this.future = [];
    this.saveStatus = "saving";
    this.appendLog(reason);
    this.publish(true);
  }

  renameSelectedEntity(name: string): boolean {
    const id = this.selectedEntityId;
    if (id === null) return false;
    let renamed: string | null = null;
    const ok = this.applySceneCommand(`Renamed ${id}`, (draft) => {
      renamed = EntityActions.renameEntity(draft, id, name);
      if (renamed === null) throw new TypeError("Entity names must be non-empty and unique.");
    });
    if (ok) {
      this.selectedEntityId = renamed;
      this.publish(false);
    }
    return ok;
  }

  duplicateSelectedEntity(): string | null {
    const id = this.selectedEntityId;
    if (id === null) return null;
    let duplicated: string | null = null;
    const ok = this.applySceneCommand(`Duplicated ${id}`, (draft) => {
      duplicated = EntityActions.duplicateEntity(draft, id);
      if (duplicated === null) throw new TypeError("The selected entity is no longer available.");
    });
    if (ok) {
      this.selectedEntityId = duplicated;
      this.publish(false);
    }
    return ok ? duplicated : null;
  }

  deleteSelectedEntity(): boolean {
    const id = this.selectedEntityId;
    if (id === null) return false;
    return this.applySceneCommand(`Deleted ${id}`, (draft) => {
      if (!EntityActions.deleteEntity(draft, id)) throw new TypeError("The selected entity is no longer available.");
    });
  }

  addComponent(type: string): boolean {
    const id = this.selectedEntityId;
    if (id === null) return false;
    return this.applySceneCommand(`Added ${type} to ${id}`, (draft) => {
      if (!ComponentActions.addComponent(draft, id, type)) throw new TypeError(`${type} cannot be added.`);
    });
  }

  removeComponent(type: string): boolean {
    const id = this.selectedEntityId;
    if (id === null) return false;
    return this.applySceneCommand(`Removed ${type} from ${id}`, (draft) => {
      const result = ComponentActions.removeComponent(draft, id, type);
      if (!result.ok) throw new TypeError(result.reason);
    });
  }

  updateComponent(type: string, label: string, mutate: (component: Record<string, unknown>) => void): boolean {
    const id = this.selectedEntityId;
    if (id === null) return false;
    return this.applySceneCommand(label, (draft) => {
      if (!ComponentActions.updateComponent(draft, id, type, mutate)) {
        throw new TypeError(`${type} is no longer attached.`);
      }
    });
  }

  previewComponent(type: string, mutate: (component: Record<string, unknown>) => void): boolean {
    const id = this.selectedEntityId;
    if (id === null) return false;
    return this.mutateDuringCoalescedSceneCommand((draft) => {
      if (!ComponentActions.updateComponent(draft, id, type, mutate)) {
        throw new TypeError(`${type} is no longer attached.`);
      }
    });
  }

  updateDraftMetadata(patch: Partial<Pick<EditorDraft, "title" | "tagline" | "slug" | "minPlayers" | "maxPlayers">>): boolean {
    return this.applySceneCommand("Updated game details", (draft) => {
      Object.assign(draft, patch);
      if (draft.title.trim() === "") throw new TypeError("The title cannot be empty.");
      if (!Number.isSafeInteger(draft.minPlayers) || !Number.isSafeInteger(draft.maxPlayers) ||
          draft.minPlayers < 1 || draft.maxPlayers > 64 || draft.minPlayers > draft.maxPlayers) {
        throw new TypeError("Player limits must be between 1 and 64.");
      }
    });
  }

  applyAiBundle(bundle: ReleaseBundleDto): boolean {
    return this.applySceneCommand("Applied AI edit", (draft) => {
      draft.bundle = structuredClone(bundle);
      draft.title = bundle.title ?? draft.title;
      draft.minPlayers = bundle.minPlayers;
      draft.maxPlayers = bundle.maxPlayers;
    });
  }

  private scheduleAutoSave(): void {
    this.saveScheduleRevision += 1;
    const requestedRevision = this.saveScheduleRevision;
    this.defer(() => {
      if (this.disposed || requestedRevision !== this.saveScheduleRevision) return;
      if (this.autoSaveTimer !== null) this.clearTimer(this.autoSaveTimer);
      this.autoSaveTimer = this.setTimer(() => {
        this.autoSaveTimer = null;
        try {
          this.saveDraft(structuredClone(this.draft));
          this.saveStatus = "saved";
          this.appendLog("Draft autosaved.");
        } catch (error) {
          this.saveStatus = "error";
          this.appendLog(error instanceof Error ? error.message : "Draft could not be saved.", "error");
        }
        this.publish(false);
      }, AUTO_SAVE_DEBOUNCE_MS);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.saveScheduleRevision += 1;
    if (this.autoSaveTimer !== null) this.clearTimer(this.autoSaveTimer);
    this.autoSaveTimer = null;
    this.listeners.clear();
  }
}

export function selectedEntity(store: EditorStore): EntityRecord | null {
  return store.getSnapshot().selectedEntity;
}
