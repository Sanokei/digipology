import { PROTOCOL_VERSION, parseServerMessage, type ActionRequest, type ClientMessage, type ServerMessage } from "digipology-protocol";
import {
  CHECKPOINT_ATTESTATION_INTERVAL,
  type CheckpointAttestationRequest,
} from "digipology-protocol/http";

import { api, type ApiClient } from "../api/client";
import type { SavedRoomSession } from "../utils/roomSession";
import { isPredictableAction, type KernelStore } from "../state/kernelStore";

export type RoomConnectionState = "connecting" | "loading_release" | "starting" | "connected" | "reconnecting" | "ended" | "error";

export interface RoomClientStatus {
  state: RoomConnectionState;
  message: string;
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

export class RoomClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseLoaded = false;
  private forceFullResync = false;
  private scriptedMessageQueue: Promise<void> = Promise.resolve();

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
      if (!response.ok) throw new Error("Canonical checkpoint was not accepted");
    },
  ) {}

  start(): void { this.stopped = false; this.connect(false); }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
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
    this.onStatus({ state: this.reconnectAttempt === 0 ? "connecting" : "reconnecting", message: this.reconnectAttempt === 0 ? "Connecting to table" : "Reconnecting…" });
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
      this.onStatus({ state: "loading_release", message: "Loading game release" });
      const result = await this.apiClient.getReleaseBundle(this.session.releaseId);
      if (!result.ok) { this.onStatus({ state: "error", message: result.error.message }); this.stopped = true; socket.close(); return; }
      try {
        this.store.loadRelease(result.value);
        await this.store.loadScriptRuntime(result.value);
        this.releaseLoaded = true;
      }
      catch { this.onStatus({ state: "error", message: "This game release could not be started." }); this.stopped = true; socket.close(); return; }
    }
    if (this.stopped || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    this.onStatus({ state: "starting", message: "Starting simulation" });
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
    this.scriptedMessageQueue = this.scriptedMessageQueue
      .then(() => this.handle(parsed.message))
      .catch((error) => this.recoverFromGap(
        error instanceof Error ? error.message : "Scripted action processing failed",
      ));
  }

  private async handle(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "bootstrap": {
        const result = this.store.bootstrap(message.sequence, message.players, message.snapshot);
        if (!result.ok) { this.recoverFromGap(`Bootstrap sequence mismatch: ${result.actual}`); return; }
        this.reconnectAttempt = 0; this.onStatus({ state: "connected", message: "Connected" }); return;
      }
      case "resume": {
        if (!this.store.hasScriptRuntime()) {
          const result = this.store.applyResume(message);
          if (!result.ok) { this.recoverFromGap(`Resume gap at ${result.actual}`); return; }
        } else {
          const expected = (this.store.getSnapshot().state?.sequence ?? -1) + 1;
          if (message.fromSequence !== expected) {
            this.recoverFromGap(`Resume gap at ${message.fromSequence}`);
            return;
          }
          for (const action of message.actions) {
            const result = await this.store.applyOrderedWithScriptRuntime(action);
            if (!result.ok) { this.recoverFromGap(`Resume gap at ${result.actual}`); return; }
            await this.reportCanonicalTimerEvents();
            await this.reportCanonicalCheckpoint();
          }
        }
        this.reconnectAttempt = 0; this.onStatus({ state: "connected", message: "Connected" }); return;
      }
      case "ordered_action": {
        const result = this.store.hasScriptRuntime()
          ? await this.store.applyOrderedWithScriptRuntime(message)
          : this.store.applyOrdered(message);
        if (!result.ok) this.recoverFromGap(`Ordered stream gap at ${result.actual}`);
        else {
          await this.reportCanonicalTimerEvents();
          await this.reportCanonicalCheckpoint();
        }
        return;
      }
      case "resync_required": this.recoverFromGap("Server requested a full resync", true); return;
      case "protocol_error":
        this.store.setDiagnostic(`${message.code}: ${message.message}`);
        this.onStatus({ state: "error", message: "The table connection could not be restored." });
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
    try {
      await this.reportCheckpointAttestation({
        sequence: confirmed.sequence,
        stateHash: confirmed.stateHash,
        snapshot: confirmed,
      });
    } catch (error) {
      this.store.setDiagnostic(
        `Checkpoint at sequence ${confirmed.sequence} was not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private send(message: ClientMessage): void { this.socket?.send(JSON.stringify(message)); }

  private recoverFromGap(diagnostic: string, fullResync = false): void {
    this.store.setDiagnostic(diagnostic);
    this.forceFullResync ||= fullResync;
    this.socket?.close(4000, "Resynchronizing");
    if (fullResync) this.releaseLoaded = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.store.dropPendingRequests();
    this.reconnectAttempt += 1;
    this.onStatus({ state: "reconnecting", message: "Connection lost. Rejoining the table…" });
    const delay = Math.min(500 * 2 ** (this.reconnectAttempt - 1), 8_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const resync = this.forceFullResync;
      this.forceFullResync = false;
      this.connect(resync);
    }, delay);
  }
}
