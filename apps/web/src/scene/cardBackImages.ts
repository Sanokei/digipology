import type { CardBackDefinition } from "./cardBack";

export interface BackImageSnapshot { status: "loading" | "ready" | "failed" | "pending"; image: HTMLImageElement | null }
type Listener = (snapshot: BackImageSnapshot) => void;
interface Entry { definition: CardBackDefinition; listeners: Set<Listener>; snapshot: BackImageSnapshot; source: HTMLImageElement | null; generation: number }
const entries = new Map<string, Entry>();

function start(entry: Entry) {
  const generation = ++entry.generation;
  entry.snapshot = { status: "loading", image: null };
  for (const listener of entry.listeners) listener(entry.snapshot);
  const image = new Image(); entry.source = image; image.decoding = "async";
  image.onload = () => {
    if (entry.generation !== generation) return;
    const good = image.naturalWidth === entry.definition.width && image.naturalHeight === entry.definition.height;
    entry.snapshot = good ? { status: "ready", image } : { status: "failed", image: null };
    for (const listener of entry.listeners) listener(entry.snapshot);
  };
  image.onerror = () => {
    if (entry.generation !== generation) return;
    entry.snapshot = { status: "failed", image: null };
    for (const listener of entry.listeners) listener(entry.snapshot);
  };
  image.src = entry.definition.src;
}

/** One decoded image per game asset, shared by decks, concealed cards and inspection. */
export function watchCardBackImage(definition: CardBackDefinition, listener: Listener): () => void {
  if (definition.pending) { listener({ status: "pending", image: null }); return () => {}; }
  let entry = entries.get(definition.key);
  if (!entry) {
    entry = { definition, listeners: new Set(), snapshot: { status: "loading", image: null }, source: null, generation: 0 };
    entries.set(definition.key, entry); start(entry);
  }
  entry.listeners.add(listener); listener(entry.snapshot);
  return () => {
    entry!.listeners.delete(listener);
    if (entry!.listeners.size === 0) {
      entry!.generation++;
      if (entry!.source) { entry!.source.onload = null; entry!.source.onerror = null; }
      entries.delete(definition.key);
    }
  };
}

export function retryCardBackImage(definition: CardBackDefinition): void {
  const entry = entries.get(definition.key);
  if (entry && entry.snapshot.status === "failed") start(entry);
}
