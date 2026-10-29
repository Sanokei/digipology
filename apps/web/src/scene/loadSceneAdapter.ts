import type { RendererAdapterKind } from "./rendererPolicy";
import type { SceneAdapter, SceneAdapterDependencies, SceneAdapterFactory } from "./sceneAdapter";

const failedEntries = new Map<RendererAdapterKind, string>();
const factories = new Map<RendererAdapterKind, SceneAdapterFactory>();
let retry = 0;

/** Chromium may retain a failed module fetch in this document. A retry may
 * request only the same origin's exact hashed renderer entry with a fresh URL;
 * no remote URL, source rewriting, eval or alternate provider is involved. */
export async function loadSceneAdapter(renderer: RendererAdapterKind, dependencies: SceneAdapterDependencies): Promise<SceneAdapter> {
  const available = factories.get(renderer);
  if (available) return available(dependencies);
  const previous = failedEntries.get(renderer);
  try {
    const fresh = previous ? new URL(previous) : null;
    if (fresh) fresh.searchParams.set("renderer-retry", String(++retry));
    const module = fresh ? await import(/* @vite-ignore */ fresh.href)
      : renderer === "lite" ? await import("./liteSceneAdapter") : await import("./webglSceneAdapter");
    const factory = renderer === "lite" ? module.createLiteSceneAdapter : module.createWebglSceneAdapter;
    if (typeof factory !== "function") throw new Error("The renderer module did not provide an adapter.");
    failedEntries.delete(renderer); factories.set(renderer, factory);
    return factory(dependencies);
  } catch (error) {
    const match = error instanceof Error ? /Failed to fetch dynamically imported module:\s*(https?:\/\/\S+)$/.exec(error.message) : null;
    if (match && typeof location !== "undefined") {
      try {
        const url = new URL(match[1]!);
        if (url.origin === location.origin && new RegExp(`^/assets/${renderer}SceneAdapter-[a-zA-Z0-9_-]+\\.js$`).test(url.pathname)) {
          url.search = ""; url.hash = ""; failedEntries.set(renderer, url.href);
        }
      } catch { /* An unknown dependency error remains an actionable view error. */ }
    }
    throw error;
  }
}
