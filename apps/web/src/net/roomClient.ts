import { PROTOCOL_VERSION, parseServerMessage, type ActionRequest, type ClientMessage, type ServerMessage } from "digipology-protocol";

import { api, type ApiClient } from "../api/client";
import type { SavedRoomSession } from "../utils/roomSession";
import { isPredictableAction, type KernelStore } from "../state/kernelStore";

export type RoomConnectionState = "connecting" | "loading_release" | "starting" | "connected" | "reconnecting" | "ended" | "error";

export interface RoomClientStatus {
  state: RoomConnectionState;
  message: string;
}

type SocketFactory = (url: string) => WebSocket;

export class RoomClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseLoaded = false;
  private forceFullResync = false;

  constructor(
    private readonly session: SavedRoomSession,
    private readonly store: KernelStore,
    private readonly onStatus: (status: RoomClientStatus) => void,
    private readonly apiClient: ApiClient = api,
    private readonly socketFactory: SocketFactory = (url) => new WebSocket(url),
  ) {}

  start(): void { this.stopped = false; this.connect(false); }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "Leaving table");
    this.socket = null;
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
      try { this.store.loadRelease(result.value); this.releaseLoaded = true; }
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
    this.handle(parsed.message);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case "bootstrap": {
        const result = this.store.bootstrap(message.sequence, message.players, message.snapshot);
        if (!result.ok) { this.recoverFromGap(`Bootstrap sequence mismatch: ${result.actual}`); return; }
        this.reconnectAttempt = 0; this.onStatus({ state: "connected", message: "Connected" }); return;
      }
      case "resume": {
        const result = this.store.applyResume(message);
        if (!result.ok) { this.recoverFromGap(`Resume gap at ${result.actual}`); return; }
        this.reconnectAttempt = 0; this.onStatus({ state: "connected", message: "Connected" }); return;
      }
      case "ordered_action": {
        const result = this.store.applyOrdered(message);
        if (!result.ok) this.recoverFromGap(`Ordered stream gap at ${result.actual}`);
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
