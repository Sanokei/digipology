import { useSyncExternalStore } from "react";

export interface TableSettings {
  graphicsQuality: "auto" | "high" | "low";
  uiScale: number;
  cameraSensitivity: number;
  invertCameraY: boolean;
  soundVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  seatPatterns: boolean;
}

export const DEFAULT_TABLE_SETTINGS: Readonly<TableSettings> = Object.freeze({
  graphicsQuality: "auto",
  uiScale: 1,
  cameraSensitivity: 1,
  invertCameraY: false,
  soundVolume: 0.8,
  muted: false,
  reducedMotion: false,
  seatPatterns: false,
});

const STORAGE_KEY = "digipology.tableSettings.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function normalizeTableSettings(value: unknown): TableSettings {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const quality = record.graphicsQuality;
  return {
    graphicsQuality: quality === "high" || quality === "low" ? quality : "auto",
    uiScale: clamp(record.uiScale, 0.8, 1.3, DEFAULT_TABLE_SETTINGS.uiScale),
    cameraSensitivity: clamp(record.cameraSensitivity, 0.5, 2, DEFAULT_TABLE_SETTINGS.cameraSensitivity),
    invertCameraY: record.invertCameraY === true,
    soundVolume: clamp(record.soundVolume, 0, 1, DEFAULT_TABLE_SETTINGS.soundVolume),
    muted: record.muted === true,
    reducedMotion: record.reducedMotion === true,
    seatPatterns: record.seatPatterns === true,
  };
}

export class TableSettingsStore {
  private value: TableSettings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: StorageLike | null = safeStorage()) {
    let stored: unknown = null;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw !== null && raw !== undefined) stored = JSON.parse(raw) as unknown;
    } catch {
      stored = null;
    }
    this.value = normalizeTableSettings(stored);
  }

  getSnapshot = (): TableSettings => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<TableSettings>): void {
    this.value = normalizeTableSettings({ ...this.value, ...patch });
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.value)); } catch { /* Device storage is optional. */ }
    for (const listener of this.listeners) listener();
  }
}

function safeStorage(): StorageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

export const tableSettingsStore = new TableSettingsStore();
export const getTableSettings = tableSettingsStore.getSnapshot;
export const subscribeTableSettings = tableSettingsStore.subscribe;

export function useTableSettings(): TableSettings {
  return useSyncExternalStore(subscribeTableSettings, getTableSettings, getTableSettings);
}
