/** The attempt deadline/owner also covers the first frames containing pieces.
 * Cancel scheduled callbacks rather than letting an old view announce readiness. */
export function firstSceneFrames(signal?: AbortSignal, request = requestAnimationFrame, cancel = cancelAnimationFrame, ready = () => true): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    const stopped = () => { if (frame !== undefined) cancel(frame); signal?.removeEventListener("abort", stopped); reject(new Error("Table renderer initialization was cancelled")); };
    if (signal?.aborted) { stopped(); return; }
    signal?.addEventListener("abort", stopped, { once: true });
    let frames = 0;
    const next = () => {
      if (ready()) frames++;
      if (frames >= 2) { signal?.removeEventListener("abort", stopped); resolve(); }
      else frame = request(next);
    };
    frame = request(next);
  });
}

/** Listen before the frame wait: a background table may become visible while
 * its renderer is still initializing. The attempt owns this temporary listener. */
export async function initializeSceneFrames(
  adapter: { setRenderLoop(running: boolean): void; presentationReady?(): boolean },
  signal?: AbortSignal,
  visibility: { readonly visibilityState: string; addEventListener(type: "visibilitychange", listener: () => void): void; removeEventListener(type: "visibilitychange", listener: () => void): void } = document,
  request = requestAnimationFrame,
  cancel = cancelAnimationFrame,
): Promise<void> {
  const update = () => adapter.setRenderLoop(!signal?.aborted && visibility.visibilityState !== "hidden");
  visibility.addEventListener("visibilitychange", update);
  try { update(); await firstSceneFrames(signal, request, cancel, () => adapter.presentationReady?.() ?? true); }
  finally { visibility.removeEventListener("visibilitychange", update); if (signal?.aborted) adapter.setRenderLoop(false); }
}
