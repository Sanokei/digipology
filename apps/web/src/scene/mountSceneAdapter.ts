import type {
  RendererAdapterKind,
  RendererAdapterSelection,
  RendererFallback,
  RendererTier,
} from "./rendererPolicy";
import type { SceneAdapter } from "./sceneAdapter";

export type SceneAdapterLoader = (renderer: RendererAdapterKind) => Promise<SceneAdapter>;

/** The deadline includes lazy imports and the first rendered frame. */
async function initializeWithin(load: SceneAdapterLoader, renderer: RendererAdapterKind, canvas: HTMLCanvasElement, tier: RendererTier, timeoutMs: number): Promise<SceneAdapter> {
  let expired = false;
  let adapter: SceneAdapter | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const initialization = (async () => {
    const loaded = await load(renderer); adapter = loaded;
    if (expired) { loaded.dispose(); throw new Error("Table renderer initialization timed out"); }
    try { await loaded.mount(canvas, { tier }); }
    finally { if (expired) loaded.dispose(); }
    return loaded;
  })();
  try {
    return await Promise.race([initialization, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("Table renderer initialization timed out")); }, timeoutMs);
    })]);
  } catch (error) {
    adapter?.dispose();
    // Imports/device acquisition cannot be aborted. Dispose late resources
    // without allowing them to mount over the current fallback renderer.
    throw error;
  } finally { clearTimeout(timer); }
}

export async function mountSceneAdapter(
  selection: RendererAdapterSelection,
  load: SceneAdapterLoader,
  canvas: HTMLCanvasElement,
  tier: RendererTier,
  onLiteFallback: (fallback: RendererFallback, error: unknown) => void,
  mountTimeoutMs = 8_000,
): Promise<SceneAdapter> {
  try { return await initializeWithin(load, selection.renderer, canvas, tier, mountTimeoutMs); }
  catch (error) {
    if (selection.renderer !== "lite") throw error;
    onLiteFallback({ from: "lite", to: "webgl", error: error instanceof Error ? error.message : String(error) }, error);
    return initializeWithin(load, "webgl", canvas, tier, mountTimeoutMs);
  }
}
