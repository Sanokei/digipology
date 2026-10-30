/** Software drivers should not queue full-size draws for an unchanged table.
 * Keep active interactions/animations at the engine's normal30fps cap, then
 * refresh an idle scene twice per second so asynchronous textures stay visible. */
export class SoftwareFrameBudget {
  private activeUntil = 0;
  private lastDraw = Number.NEGATIVE_INFINITY;
  deltaMs = 0;
  wake(now: number): void { this.activeUntil = now + 1_200; }
  shouldDraw(now: number, animating = false): boolean {
    if (!animating && now > this.activeUntil && now - this.lastDraw < 500) return false;
    this.deltaMs = Number.isFinite(this.lastDraw) ? now - this.lastDraw : 0;
    this.lastDraw = now; return true;
  }
}

/** Never block the browser or queue another software frame behind a busy GPU. */
export class SoftwareGpuFrame {
  private pending: WebGLSync | null = null;
  private disabled = false;
  completed = false;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  available(): boolean {
    if (this.pending === null) return true;
    const status = this.gl.clientWaitSync(this.pending, 0, 0);
    if (status === this.gl.TIMEOUT_EXPIRED) return false;
    this.gl.deleteSync(this.pending); this.pending = null;
    if (status === this.gl.WAIT_FAILED) this.disabled = true;
    this.completed = true;
    return true;
  }
  submitted(): void {
    if (this.disabled) { this.completed = true; return; }
    this.pending = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (this.pending === null) { this.disabled = true; this.completed = true; }
    else this.gl.flush();
  }
  dispose(): void { if (this.pending) this.gl.deleteSync(this.pending); this.pending = null; }
}
