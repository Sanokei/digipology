import type { RendererAdapterKind, RendererAdapterSelection, RendererTier } from "./rendererPolicy";
import type { SceneAdapter } from "./sceneAdapter";

export type SceneAdapterLoader = (renderer: RendererAdapterKind) => Promise<SceneAdapter>;

export async function mountSceneAdapter(
  selection: RendererAdapterSelection,
  load: SceneAdapterLoader,
  canvas: HTMLCanvasElement,
  tier: RendererTier,
  onLiteFallback: (error: unknown) => void,
): Promise<SceneAdapter> {
  let adapter = await load(selection.renderer);
  try {
    await adapter.mount(canvas, { tier });
    return adapter;
  } catch (error) {
    adapter.dispose();
    if (selection.renderer !== "lite") throw error;
    onLiteFallback(error);
    adapter = await load("webgl");
    await adapter.mount(canvas, { tier });
    return adapter;
  }
}

