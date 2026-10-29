/** The attempt deadline/owner also covers the first frames containing pieces.
 * Cancel scheduled callbacks rather than letting an old view announce readiness. */
export function firstSceneFrames(signal?: AbortSignal, request = requestAnimationFrame, cancel = cancelAnimationFrame): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    const stopped = () => { if (frame !== undefined) cancel(frame); signal?.removeEventListener("abort", stopped); reject(new Error("Table renderer initialization was cancelled")); };
    if (signal?.aborted) { stopped(); return; }
    signal?.addEventListener("abort", stopped, { once: true });
    frame = request(() => {
      frame = request(() => { signal?.removeEventListener("abort", stopped); resolve(); });
    });
  });
}
