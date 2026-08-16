import { PROTOCOL_VERSION, parseServerMessage, type ActionRequest, type ClientMessage, type ServerMessage } from "digipology-protocol";
import {
  ACTION_RETENTION,
  CHECKPOINT_ATTESTATION_INTERVAL,
  type CheckpointAttestationRequest,
} from "digipology-protocol/http";
import { snapshot, type CanonicalGameState, type GameSnapshot } from "digipology-kernel";

import { api, type ApiClient } from "../api/client";
import type { SavedRoomSession } from "../utils/roomSession";
import { isPredictableAction, type KernelStore } from "../state/kernelStore";

export const MAX_RECONNECT_ATTEMPTS = 8;
export const SYNCHRONIZING_RESUME_THRESHOLD = 50;

export type RoomConnectionState = "connecting" | "loading_release" | "starting" | "connected" | "reconnecting" | "synchronizing" | "ended" | "error";

export interface RoomClientStatus {
  state: RoomConnectionState;
  message: string;
  detail?: string;
  recoverable?: boolean;
  progress?: { applied: number; total: number };
}

type SocketFactory = (url: string) => WebSocket;
type TimerMetadataReporter = (input: {
  operation: "register" | "cancel";
  timerId: string;
  delay?: number;
}) => Promise<void>;
type CheckpointAttestationReporter = (
  input: Omit<CheckpointAttestationRequest, "roomToken">,
) => Promise<void>;
type ReconnectTimer = ReturnType<typeof setTimeout>;
interface ReconnectTimerScheduler {
  set(callback: () => void, delay: number): ReconnectTimer;
  clear(timer: ReconnectTimer): void;
}

export class CheckpointAttestationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = "Canonical checkpoint was not accepted",
  ) {
    super(message);
    this.name = "CheckpointAttestationError";
  }
}

export class RoomClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseLoaded = false;
  private forceFullResync = false;
  private scriptedMessageQueue: Promise<void> = Promise.resolve();
  private bootstrapBase: number | null = null;
  private bootstrapCadenceState: CanonicalGameState | null = null;
  private bootstrapFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private bootstrapGeneration = 0;
  private hasCompletedHandshake = false;
  private synchronizingBootstrap = false;

  constructor(
    private readonly session: SavedRoomSession,
    private readonly store: KernelStore,
    private readonly onStatus: (status: RoomClientStatus) => void,
    private readonly apiClient: ApiClient = api,
    private readonly socketFactory: SocketFactory = (url) => new WebSocket(url),
    private readonly reportTimerMetadata: TimerMetadataReporter = async (input) => {
      const response = await fetch(`/api/rooms/${encodeURIComponent(session.roomId)}/timers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Digipology-CSRF": "1" },
        body: JSON.stringify({ roomToken: session.roomToken, ...input }),
      });
      if (!response.ok) throw new Error("Canonical timer metadata was not accepted");
    },
    private readonly reportCheckpointAttestation: CheckpointAttestationReporter = async (input) => {
      const response = await fetch(`/api/rooms/${encodeURIComponent(session.roomId)}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Digipology-CSRF": "1" },
        body: JSON.stringify({ roomToken: session.roomToken, ...input }),
      });
      if (!response.ok) {
        let code = "checkpoint_rejected";
        let message = "Canonical checkpoint was not accepted";
        try {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && !Array.isArray(body)) {
            const error = Reflect.get(body, "error");
            if (typeof error === "object" && error !== null && !Array.isArray(error)) {
              const bodyCode = Reflect.get(error, "code");
              const bodyMessage = Reflect.get(error, "message");
              if (typeof bodyCode === "string") code = bodyCode;
              if (typeof bodyMessage === "string") message = bodyMessage;
            }
          }
        } catch {
          // Preserve the generic typed error when the response body is not JSON.
        }
        throw new CheckpointAttestationError(response.status, code, message);
      }
    },
    private readonly reconnectTimers: ReconnectTimerScheduler = {
      set: (callback, delay) => setTimeout(callback, delay),
      clear: (timer) => clearTimeout(timer),
    },
  ) {}

  start(): void {
    if (this.reconnectTimer !== null) this.reconnectTimers.clear(this.reconnectTimer);
    this.reconnectTimer = null;
    this.cancelBootstrapCatchUp();
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.forceFullResync = false;
    this.hasCompletedHandshake = false;
    this.connect(false);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) this.reconnectTimers.clear(this.reconnectTimer);
    this.cancelBootstrapCatchUp();
    this.socket?.close(1000, "Leaving table");
    this.socket = null;
    this.store.dispose();
  }

  sendAction(action: { type: string; payload: unknown }): string | null {
    const sequence = this.store.getSnapshot().state?.sequence;
    if (this.socket?.readyState !== WebSocket.OPEN || sequence === undefined) return null;
    const requestId = crypto.randomUUID();
    const request: ActionRequest = { type: "action_request", protocolVersion: PROTOCOL_VERSION, requestId, predictedAtSequence: sequence, action };
    if (isPredictableAction(action)) {
      const accepted = this.store.predictLocal(
        { requestId, action, predictedAtSequence: sequence },
        this.session.playerId,
      );
      if (!accepted) return null;
    } else {
      this.store.trackRequest(requestId);
    }
    this.send(request);
    return requestId;
  }

  private connect(resync: boolean): void {
    if (this.stopped) return;
    this.onStatus({ state: this.reconnectAttempt === 0 ? "connecting" : "reconnecting", message: this.reconnectAttempt === 0 ? "Joining Table" : "Reconnecting" });
    let socket: WebSocket;
    try { socket = this.socketFactory(this.session.wsUrl); }
    catch { this.scheduleReconnect(); return; }
    this.socket = socket;
    socket.addEventListener("open", () => { void this.opened(socket, resync); });
    socket.addEventListener("message", (event) => this.received(event.data));
    socket.addEventListener("close", () => { if (!this.stopped && socket === this.socket && this.store.getSnapshot().endedReason === null) this.scheduleReconnect(); });
    socket.addEventListener("error", () => this.store.setDiagnostic("WebSocket transport error"));
  }

  private async opened(socket: WebSocket, resync: boolean): Promise<void> {
    if (!this.releaseLoaded || resync) {
      this.onStatus({ state: "loading_release", message: "Loading Game" });
      const result = await this.apiClient.getReleaseBundle(this.session.releaseId);
      if (!result.ok) { this.store.setDiagnostic(result.error.message); this.onStatus({ state: "error", message: "This game could not be loaded.", recoverable: true }); this.stopped = true; socket.close(); return; }
      try {
        this.store.loadRelease(result.value);
        await this.store.loadScriptRuntime(result.value);
        this.releaseLoaded = true;
      }
      catch { this.onStatus({ state: "error", message: "This game could not be started.", recoverable: true }); this.stopped = true; socket.close(); return; }
    }
    if (this.stopped || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    this.onStatus({ state: "starting", message: "Joining Table" });
    const firstHandshake = this.reconnectAttempt === 0 && !resync;
    this.send({
      type: "hello", protocolVersion: PROTOCOL_VERSION, sessionToken: this.session.roomToken,
      lastSequence: firstHandshake || resync ? null : this.store.getSnapshot().state?.sequence ?? null,
    });
  }

  private received(data: unknown): void {
    if (typeof data !== "string") { this.recoverFromGap("Received a non-text server message"); return; }
    const parsed = parseServerMessage(data);
    if (!parsed.ok) { this.recoverFromGap(`Protocol parse error: ${parsed.error.detail}`); return; }
    if (!this.store.hasScriptRuntime()) {
      void this.handle(parsed.message);
      return;
    }
    if (parsed.message.type === "bootstrap") {
      this.beginBootstrapCatchUp(parsed.message.sequence);
    }
    this.scriptedMessageQueue = this.scriptedMessageQueue
      .then(() => this.handle(parsed.message))
      .catch((error) => this.recoverFromGap(
        error instanceof Error ? error.message : "Scripted action processing failed",
      ));
    if (this.bootstrapBase !== null) this.scheduleBootstrapCatchUpFlush();
  }

  private async handle(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "bootstrap": {
        const synchronizing = this.hasCompletedHandshake;
        if (synchronizing) this.onStatus({ state: "synchronizing", message: "Synchronizing Table" });
        const result = this.store.bootstrap(message.sequence, message.players, message.snapshot);
        if (!result.ok) { this.recoverFromGap(`Bootstrap sequence mismatch: ${result.actual}`); return; }
        this.hasCompletedHandshake = true;
        this.reconnectAttempt = 0;
        if (!this.store.hasScriptRuntime() || !synchronizing) this.onStatus({ state: "connected", message: "Connected" });
        return;
      }
      case "resume": {
        const synchronizing = message.actions.length > SYNCHRONIZING_RESUME_THRESHOLD;
        if (synchronizing) this.onStatus({ state: "synchronizing", message: "Synchronizing Table", progress: { applied: 0, total: message.actions.length } });
        if (!this.store.hasScriptRuntime()) {
          const result = this.store.applyResume(message);
          if (!result.ok) { this.recoverFromGap(`Resume gap at ${result.actual}`); return; }
          if (synchronizing) this.onStatus({ state: "synchronizing", message: "Synchronizing Table", progress: { applied: message.actions.length, total: message.actions.length } });
        } else {
          const expected = (this.store.getSnapshot().state?.sequence ?? -1) + 1;
          if (message.fromSequence !== expected) {
            this.recoverFromGap(`Resume gap at ${message.fromSequence}`);
            return;
          }
          const resumeBase = message.fromSequence - 1;
          let cadenceState: CanonicalGameState | null = null;
          for (let index = 0; index < message.actions.length; index += 1) {
            const action = message.actions[index]!;
            const result = await this.store.applyOrderedWithScriptRuntime(action);
            if (!result.ok) { this.recoverFromGap(`Resume gap at ${result.actual}`); return; }
            await this.reportCanonicalTimerEvents();
            if (synchronizing) this.onStatus({ state: "synchronizing", message: "Synchronizing Table", progress: { applied: index + 1, total: message.actions.length } });
            if (action.sequence > resumeBase &&
              action.sequence % CHECKPOINT_ATTESTATION_INTERVAL === 0) {
              cadenceState = this.store.getSnapshot().state;
            }
          }
          await this.reportCatchUpCheckpoint(resumeBase, cadenceState);
        }
        this.hasCompletedHandshake = true; this.reconnectAttempt = 0; this.onStatus({ state: "connected", message: "Connected" }); return;
      }
      case "ordered_action": {
        const result = this.store.hasScriptRuntime()
          ? await this.store.applyOrderedWithScriptRuntime(message)
          : this.store.applyOrdered(message);
        if (!result.ok) this.recoverFromGap(`Ordered stream gap at ${result.actual}`);
        else {
          await this.reportCanonicalTimerEvents();
          if (this.bootstrapBase !== null) {
            if (message.sequence > this.bootstrapBase &&
              message.sequence % CHECKPOINT_ATTESTATION_INTERVAL === 0) {
              this.bootstrapCadenceState = this.store.getSnapshot().state;
            }
          } else {
            await this.reportCanonicalCheckpoint();
          }
        }
        return;
      }
      case "resync_required": this.recoverFromGap("Server requested a full resync", true); return;
      case "protocol_error":
        if (message.code === "bootstrap_unavailable") {
          this.cancelBootstrapCatchUp();
          this.onStatus({
            state: "error",
            message: "This table isn't ready for new players yet.",
            detail: message.message,
            recoverable: true,
          });
          this.stopped = true;
          this.socket?.close(4002, "Bootstrap unavailable");
          return;
        }
        this.store.setDiagnostic(`${message.code}: ${message.message}`);
        this.cancelBootstrapCatchUp();
        this.onStatus({ state: "error", message: "The table connection could not be restored.", recoverable: true });
        this.stopped = true;
        this.socket?.close(4001, "Protocol error");
        return;
      case "room_ended": this.store.roomEnded(message.reason); this.onStatus({ state: "ended", message: "This table has ended." }); this.stop(); return;
      case "pong": return;
    }
  }

  /**
   * Timer metadata is best-effort: the room only stores due times and the first
   * writer wins, so a rejected or failed report must never tear down the ordered
   * stream (another client may already have registered the same timer).
   */
  private async reportCanonicalTimerEvents(): Promise<void> {
    for (const event of this.store.getSnapshot().events) {
      let input: Parameters<TimerMetadataReporter>[0] | null = null;
      if (event.type === "timer.registered" && typeof event.data.timerId === "string" && typeof event.data.delay === "number") {
        input = { operation: "register", timerId: event.data.timerId, delay: event.data.delay };
      } else if (event.type === "timer.canceled" && typeof event.data.timerId === "string") {
        input = { operation: "cancel", timerId: event.data.timerId };
      }
      if (input === null) continue;
      try { await this.reportTimerMetadata(input); }
      catch (error) {
        this.store.setDiagnostic(`Timer ${input.operation} for ${input.timerId} was not recorded: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Best-effort and always authored from confirmed, never predicted, state. */
  private async reportCanonicalCheckpoint(): Promise<void> {
    if (!this.store.requiresScripts()) return;
    const sequence = this.store.getSnapshot().state?.sequence ?? 0;
    if (sequence <= 0 || sequence % CHECKPOINT_ATTESTATION_INTERVAL !== 0) return;
    // Only serialize/hash the full state on the cadence, never per action.
    const confirmed = this.store.confirmedSnapshot();
    if (confirmed === null || confirmed.sequence !== sequence) return;
    await this.reportCheckpointSnapshot(confirmed);
  }

  private beginBootstrapCatchUp(baseSequence: number): void {
    if (this.bootstrapFlushTimer !== null) clearTimeout(this.bootstrapFlushTimer);
    this.bootstrapBase = baseSequence;
    this.bootstrapCadenceState = null;
    this.synchronizingBootstrap = this.hasCompletedHandshake;
    this.bootstrapGeneration += 1;
  }

  private scheduleBootstrapCatchUpFlush(): void {
    if (this.bootstrapFlushTimer !== null) clearTimeout(this.bootstrapFlushTimer);
    const generation = ++this.bootstrapGeneration;
    this.bootstrapFlushTimer = setTimeout(() => {
      this.bootstrapFlushTimer = null;
      void this.finishBootstrapCatchUp(generation);
    }, 25);
  }

  private cancelBootstrapCatchUp(): void {
    if (this.bootstrapFlushTimer !== null) clearTimeout(this.bootstrapFlushTimer);
    this.bootstrapFlushTimer = null;
    this.bootstrapBase = null;
    this.bootstrapCadenceState = null;
    this.synchronizingBootstrap = false;
    this.bootstrapGeneration += 1;
  }

  private async finishBootstrapCatchUp(generation: number): Promise<void> {
    await this.scriptedMessageQueue;
    if (generation !== this.bootstrapGeneration || this.bootstrapBase === null) return;
    const baseSequence = this.bootstrapBase;
    const cadenceState = this.bootstrapCadenceState;
    this.bootstrapBase = null;
    this.bootstrapCadenceState = null;
    await this.reportCatchUpCheckpoint(baseSequence, cadenceState);
    if (this.synchronizingBootstrap) {
      this.synchronizingBootstrap = false;
      this.reconnectAttempt = 0;
      this.onStatus({ state: "connected", message: "Connected" });
    }
  }

  private async reportCatchUpCheckpoint(
    baseSequence: number,
    cadenceState: CanonicalGameState | null,
  ): Promise<void> {
    if (!this.store.requiresScripts() || cadenceState === null) return;
    const currentSequence = this.store.getSnapshot().state?.sequence ?? 0;
    if (cadenceState.sequence <= baseSequence ||
      cadenceState.sequence < currentSequence - ACTION_RETENTION + 1) return;
    await this.reportCheckpointSnapshot(snapshot(cadenceState));
  }

  private async reportCheckpointSnapshot(confirmed: GameSnapshot): Promise<void> {
    try {
      await this.reportCheckpointAttestation({
        sequence: confirmed.sequence,
        stateHash: confirmed.stateHash,
        snapshot: confirmed,
      });
    } catch (error) {
      if (error instanceof CheckpointAttestationError &&
        error.status === 409 && error.code === "checkpoint_conflicted") return;
      this.store.setDiagnostic(
        `Checkpoint at sequence ${confirmed.sequence} was not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private send(message: ClientMessage): void { this.socket?.send(JSON.stringify(message)); }

  private recoverFromGap(diagnostic: string, fullResync = false): void {
    this.store.setDiagnostic(diagnostic);
    // The stream restarts (resume or full bootstrap); drop any pending catch-up attestation.
    this.cancelBootstrapCatchUp();
    this.forceFullResync ||= fullResync;
    this.socket?.close(4000, "Resynchronizing");
    if (fullResync) this.releaseLoaded = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.store.dropPendingRequests();
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.stopped = true;
      this.onStatus({
        state: "error",
        message: "The table connection could not be restored.",
        detail: "Reload the table to try joining again.",
        recoverable: true,
      });
      return;
    }
    this.reconnectAttempt += 1;
    this.onStatus({ state: "reconnecting", message: "Reconnecting" });
    const delay = Math.min(500 * 2 ** (this.reconnectAttempt - 1), 8_000);
    this.reconnectTimer = this.reconnectTimers.set(() => {
      this.reconnectTimer = null;
      const resync = this.forceFullResync;
      this.forceFullResync = false;
      this.connect(resync);
    }, delay);
  }
}
