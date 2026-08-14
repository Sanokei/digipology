import type { EntityComponents, EntityRecord } from "digipology-kernel";
import type { ReleaseBundleDto } from "digipology-protocol/http";

export interface EditorDraft {
  editorVersion: 1;
  id: string;
  title: string;
  tagline: string;
  slug: string;
  minPlayers: number;
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
  bundle: ReleaseBundleDto;
}

export interface DraftIndexEntry {
  version: 1;
  id: string;
  title: string;
  updatedAt: string;
}

export interface EditorLogEntry {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
  timestamp: string;
}

export interface HistoryFrame {
  label: string;
  draft: EditorDraft;
  selectedEntityId: string | null;
  timestamp: string;
}

export interface EditorSnapshot {
  draft: EditorDraft;
  bundle: ReleaseBundleDto;
  entities: Readonly<Record<string, EntityRecord>>;
  selectedEntityId: string | null;
  selectedEntity: EntityRecord | null;
  past: readonly HistoryFrame[];
  future: readonly HistoryFrame[];
  logs: readonly EditorLogEntry[];
  revision: number;
  saveStatus: "saved" | "saving" | "error";
}

export type EditorComponentType = keyof EntityComponents | "script";

export interface ScriptBindingComponent {
  scriptId: string;
  bindingId: string;
  props: Record<string, unknown>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
