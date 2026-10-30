import type {
  RendererAdapterKind,
  RendererAdapterSelection,
  RendererFallback,
  RendererTier,
} from "./rendererPolicy";
import type { SceneAdapter } from "./sceneAdapter";

export type SceneAdapterLoader = (renderer: RendererAdapterKind) => Promise<SceneAdapter>;

export type SceneCanvasSource = HTMLCanvasElement | (() => HTMLCanvasElement);

// Measured software cold starts can exceed8s while capability/shader queries
// block. This remains one total attempt budget, never reset by progress.
export const TABLE_RENDER_TIMEOUT_MS = 12_000;

/** Includes lazy import, GPU/scene assets and the first frame. The canvas factory gives
 * each attempt its own surface; a late device only touches its retired canvas. */
async function initializeWithin(load: SceneAdapterLoader, renderer: RendererAdapterKind, source: SceneCanvasSource, tier: RendererTier, timeoutMs: number, owner?: AbortSignal): Promise<SceneAdapter> {
  const lifetime = new AbortController();
  let adapter: SceneAdapter | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const disposeCurrent = () => { if (adapter && !disposed) { disposed = true; adapter.dispose(); } };
  let rejectCancelled!: (reason: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const cancel = (reason: Error) => { lifetime.abort(); disposeCurrent(); rejectCancelled(reason); };
  const ownerLeft = () => cancel(new Error("Table renderer initialization was cancelled"));
  owner?.addEventListener("abort", ownerLeft, { once: true });
  const initialization = (async () => {
    if (owner?.aborted) { ownerLeft(); throw new Error("Table renderer initialization was cancelled"); }
    const canvas = typeof source === "function" ? source() : source;
    const loaded = await load(renderer); adapter = loaded;
    try {
      if (lifetime.signal.aborted) throw new Error("Table renderer initialization was cancelled");
      await loaded.mount(canvas, { tier, signal: lifetime.signal });
      if (lifetime.signal.aborted) throw new Error("Table renderer initialization was cancelled");
      return loaded;
    } finally { if (lifetime.signal.aborted) loaded.dispose(); }
  })();
  try {
    timer = setTimeout(() => cancel(new Error("Table renderer initialization timed out")), timeoutMs);
    return await Promise.race([initialization, cancelled]);
  } catch (error) { lifetime.abort(); disposeCurrent(); throw error; }
  finally { clearTimeout(timer); owner?.removeEventListener("abort", ownerLeft); }
}

export async function mountSceneAdapter(
  selection: RendererAdapterSelection,
  load: SceneAdapterLoader,
  canvas: SceneCanvasSource,
  tier: RendererTier,
  onLiteFallback: (fallback: RendererFallback, error: unknown) => void,
  mountTimeoutMs = TABLE_RENDER_TIMEOUT_MS,
  owner?: AbortSignal,
): Promise<SceneAdapter> {
  try { return await initializeWithin(load, selection.renderer, canvas, tier, mountTimeoutMs, owner); }
  catch (error) {
    if (owner?.aborted || selection.renderer !== "lite") throw error;
    onLiteFallback({ from: "lite", to: "webgl", error: error instanceof Error ? error.message : String(error) }, error);
    return initializeWithin(load, "webgl", canvas, tier, mountTimeoutMs, owner);
  }
}
