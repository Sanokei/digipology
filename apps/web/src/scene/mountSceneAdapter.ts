import type {
  RendererAdapterKind,
  RendererAdapterSelection,
  RendererFallback,
  RendererTier,
} from "./rendererPolicy";
import type { SceneAdapter } from "./sceneAdapter";

export type SceneAdapterLoader = (renderer: RendererAdapterKind) => Promise<SceneAdapter>;

async function mountWithin(adapter: SceneAdapter, canvas: HTMLCanvasElement, tier: RendererTier, timeoutMs: number): Promise<void> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mounting = adapter.mount(canvas, { tier });
  try {
    await Promise.race([mounting, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("Table renderer initialization timed out")); }, timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    // GPU device acquisition cannot be aborted. If it finishes after fallback
    // or an error, release its late resources without touching the new adapter.
    if (expired) void mounting.then(() => adapter.dispose(), () => adapter.dispose());
  }
}

export async function mountSceneAdapter(
  selection: RendererAdapterSelection,
  load: SceneAdapterLoader,
  canvas: HTMLCanvasElement,
  tier: RendererTier,
  onLiteFallback: (fallback: RendererFallback, error: unknown) => void,
  mountTimeoutMs = 8_000,
): Promise<SceneAdapter> {
  let adapter = await load(selection.renderer);
  try {
    await mountWithin(adapter, canvas, tier, mountTimeoutMs);
    return adapter;
  } catch (error) {
    adapter.dispose();
    if (selection.renderer !== "lite") throw error;
    onLiteFallback(
      {
        from: "lite",
        to: "webgl",
        error: error instanceof Error ? error.message : String(error),
      },
      error,
    );
    adapter = await load("webgl");
    try { await mountWithin(adapter, canvas, tier, mountTimeoutMs); }
    catch (fallbackError) { adapter.dispose(); throw fallbackError; }
    return adapter;
  }
}
