import type {
  PresentationSettings,
  PresentationSettingsSource,
  TableStyle,
} from "./sceneAdapter";

const TABLE_STYLES = new Set<TableStyle>(["felt-green", "dark-wood", "slate", "parchment"]);

export function defaultPresentationSettings(
  reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
): PresentationSettings {
  return {
    reducedMotion,
    reducedAudio: reducedMotion,
    muted: false,
    volume: 0.7,
    tableStyle: "felt-green",
  };
}

export function sanitizePresentationSettings(
  value: Partial<PresentationSettings>,
  fallback = defaultPresentationSettings(false),
): PresentationSettings {
  return {
    reducedMotion: value.reducedMotion ?? fallback.reducedMotion,
    reducedAudio: value.reducedAudio ?? fallback.reducedAudio,
    muted: value.muted ?? fallback.muted,
    volume: Number.isFinite(value.volume) ? Math.min(Math.max(value.volume ?? fallback.volume, 0), 1) : fallback.volume,
    tableStyle: value.tableStyle !== undefined && TABLE_STYLES.has(value.tableStyle)
      ? value.tableStyle
      : fallback.tableStyle,
  };
}

/**
 * Device-local presentation settings. Shells may provide their own store through
 * SceneAdapterDependencies; this implementation is the browser-safe fallback.
 */
export function createPresentationSettingsStore(
  initial = defaultPresentationSettings(),
): PresentationSettingsSource & { set(patch: Partial<PresentationSettings>): void } {
  let current = sanitizePresentationSettings(initial);
  const listeners = new Set<(settings: PresentationSettings) => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(patch) {
      const next = sanitizePresentationSettings(patch, current);
      if (Object.entries(next).every(([key, value]) => current[key as keyof PresentationSettings] === value)) return;
      current = next;
      for (const listener of listeners) listener(current);
    },
  };
}

export const browserPresentationSettings = createPresentationSettingsStore();
