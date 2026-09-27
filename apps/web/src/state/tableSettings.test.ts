import { describe, expect, test } from "bun:test";
import { DEFAULT_TABLE_SETTINGS, TableSettingsStore, normalizeTableSettings } from "./tableSettings";

describe("table settings", () => {
  test("normalizes corrupt and out-of-range device values", () => {
    expect(normalizeTableSettings({
      graphicsQuality: "ultra",
      uiScale: 9,
      cameraSensitivity: -1,
      soundVolume: 4,
      muted: true,
    })).toEqual({
      ...DEFAULT_TABLE_SETTINGS,
      uiScale: 1.3,
      cameraSensitivity: 0.5,
      soundVolume: 1,
      muted: true,
    });
  });

  test("persists updates and survives unavailable storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const store = new TableSettingsStore(storage);
    store.update({ graphicsQuality: "low", uiScale: 1.15, seatPatterns: true });
    expect(new TableSettingsStore(storage).getSnapshot()).toMatchObject({
      graphicsQuality: "low", uiScale: 1.15, seatPatterns: true,
    });
    const unavailable = new TableSettingsStore({
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    expect(() => unavailable.update({ muted: true })).not.toThrow();
    expect(unavailable.getSnapshot().muted).toBe(true);
  });
});
