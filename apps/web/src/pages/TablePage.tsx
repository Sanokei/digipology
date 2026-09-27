import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CanonicalGameState, EntityRecord, PromptRecord } from "digipology-kernel";
import type { GameSnapshotDto } from "digipology-protocol/http";

import { api } from "../api/client";
import { ConnectionOverlay } from "../components/ConnectionOverlay";
import { HandStrip } from "../components/HandStrip";
import { ObjectsMenu } from "../components/ObjectsMenu";
import { RemotePresenceOverlay, type RemoteCursor, type RemotePing } from "../components/RemotePresenceOverlay";
import { TableChat } from "../components/TableChat";
import {
  GamePanel,
  HandCountEdges,
  HelpPanel,
  LogPanel,
  PlayersPanel,
  RulesPanel,
  SettingsPanel,
  TableMenuBar,
} from "../components/TableHud";
import { RoomClient, type RoomClientStatus } from "../net/roomClient";
import { rendererOverrideFromSearch, type RendererSelectionReason, type RendererStatus } from "../scene/rendererPolicy";
import { TableScene } from "../scene/TableScene";
import { seatPaletteEntry } from "../seatPalette";
import { KernelStore } from "../state/kernelStore";
import { useTableSettings } from "../state/tableSettings";
import { useKernelStore } from "../state/useKernelStore";
import { loadRoomSession, saveRoomSession } from "../utils/roomSession";
import { diceControlLabels } from "./tableContextModel";
import { localHandItems } from "./tableHandModel";
import { appendGameLog, type GameLogLine } from "./tableLogModel";
import { currentTurnPlayerId, gameIsOver, type TablePanelId } from "./tableShellModel";
import { TABLE_PING_LIFETIME_MS, createChatModel, reduceChatModel } from "./tableSocialModel";

const INITIAL_STATUS: RoomClientStatus = { state: "connecting", message: "Joining Table" };
const RENDERER_REASON_TEXT: Record<RendererSelectionReason, string> = {
  webgpu: "WebGPU is available",
  "no-webgpu": "WebGPU is unavailable",
  "override-lite": "Lite requested by URL",
  "override-webgl": "WebGL requested by URL",
  "override-lite-no-webgpu": "Lite requested without WebGPU",
};

export function RendererDiagnostics({ status }: { status: RendererStatus | null }) {
  return <>
    <dt>Renderer</dt><dd>{status?.mounted ?? "Starting…"}</dd>
    <dt>Selected because</dt><dd>{status === null ? "Pending" : RENDERER_REASON_TEXT[status.reason]}</dd>
    <dt>Fallback</dt><dd>{status?.fallback ? `Lite failed to start: ${status.fallback.error}` : "none"}</dd>
    <dt>Tier</dt><dd>{status?.tier ?? "—"}</dd>
  </>;
}

export function playersPanelOpenByDefault(_matchesDesktop: boolean): boolean { return true; }

export function openPromptsForPlayer(state: CanonicalGameState | null, playerId: string): PromptRecord[] {
  return Object.values(state?.prompts ?? {})
    .filter((prompt) => prompt.status === "open" && prompt.playerId === playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function DiceControls({ dice, definitions, disabled, onRoll }: {
  dice: readonly EntityRecord[];
  definitions: Readonly<Record<string, { label?: string }>>;
  disabled: boolean;
  onRoll(entityId: string): void;
}) {
  if (dice.length === 0) return null;
  const labels = diceControlLabels(dice, definitions);
  return <aside className="dice-controls"><span>Dice</span>{dice.map((entity) =>
    <button type="button" disabled={disabled} key={entity.id} onClick={() => onRoll(entity.id)}>
      Roll {labels.get(entity.id) ?? "Die"}
    </button>)}</aside>;
}

function PromptTray({ prompt, countdown, disabled, respond }: {
  prompt: PromptRecord;
  countdown: number | null;
  disabled: boolean;
  respond(value: unknown): void;
}) {
  const [remaining, setRemaining] = useState(countdown);
  useEffect(() => {
    setRemaining(countdown);
    if (countdown === null) return;
    const timer = setInterval(() => setRemaining((value) => value === null ? null : Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, [countdown, prompt.id]);
  return <aside className="prompt-panel table-sheet" aria-label="Game choice">
    <header><span>Your decision</span>{remaining === null ? null : <time>{remaining}s</time>}</header>
    <strong>{prompt.title}</strong>
    {prompt.kind === "choice" ? <div>{(prompt.choices ?? []).map((choice, index) =>
      <button type="button" disabled={disabled} key={index} onClick={() => respond(choice)}>
        {typeof choice === "string" ? choice : JSON.stringify(choice)}
      </button>)}</div> : null}
    {prompt.kind === "confirm" ? <div>
      <button type="button" disabled={disabled} onClick={() => respond(true)}>Yes</button>
      <button type="button" disabled={disabled} onClick={() => respond(false)}>No</button>
    </div> : null}
    {prompt.kind === "number" ? <form onSubmit={(event) => {
      event.preventDefault();
      respond(Number(new FormData(event.currentTarget).get("response")));
    }}>
      <input name="response" type="number" min={prompt.min} max={prompt.max} step={prompt.step}
        defaultValue={typeof prompt.default === "number" ? prompt.default : prompt.min} />
      <button type="submit" disabled={disabled}>Choose</button>
    </form> : null}
  </aside>;
}

export function TablePage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const session = useMemo(() => loadRoomSession(roomId), [roomId]);
  const [clientGeneration, setClientGeneration] = useState(0);
  const store = useMemo(() => new KernelStore(), [clientGeneration, roomId]);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const client = useMemo(
    () => session === null ? null : new RoomClient(session, store, setStatus),
    [clientGeneration, session, store],
  );
  const view = useKernelStore(store);
  const settings = useTableSettings();
  const [activePanel, setActivePanel] = useState<TablePanelId>("players");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<GameLogLine[]>([]);
  const [projectToTable, setProjectToTable] = useState<((x: number, y: number) => { x: number; y: number; z: number } | null) | undefined>();
  const [projectFromTable, setProjectFromTable] = useState<((point: { x: number; y: number; z: number }) => { x: number; y: number } | null) | null>(null);
  const [chat, updateChat] = useReducer(reduceChatModel, undefined, createChatModel);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [remotePings, setRemotePings] = useState<RemotePing[]>([]);
  const [rendererStatus, setRendererStatus] = useState<RendererStatus | null>(null);
  const nextPingId = useRef(1);
  const previousTurn = useRef<string | null>(null);
  const spawnPoint = useRef({ x: 0, y: .08, z: 0 });
  const host = view.players.find((player) => player.playerId === session?.playerId)?.host === true;
  const rendererOverrideActive = typeof window !== "undefined" && rendererOverrideFromSearch(window.location.search) !== null;

  const choosePanel = useCallback((panel: TablePanelId) => {
    setActivePanel(panel);
    updateChat({ type: panel === "chat" ? "open" : "close" });
  }, []);

  useEffect(() => { client?.start(); return () => client?.stop(); }, [client]);
  useEffect(() => updateChat({ type: "reset" }), [roomId]);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => setLog((previous) => appendGameLog(previous, view.events, view.players, host)), [host, view.events, view.players]);
  useEffect(() => {
    const turn = currentTurnPlayerId(view.state);
    if (turn === session?.playerId && previousTurn.current !== turn) setNotice("It’s your turn");
    previousTurn.current = turn;
  }, [session?.playerId, view.state]);
  useEffect(() => { if (gameIsOver(view.state)) setNotice("Game over"); }, [view.state]);
  useEffect(() => {
    if (client === null || session === null) return;
    return client.subscribeControl((message) => {
      if (message.type === "room_redirect") {
        const gameSlug = view.gameSlug ?? session.gameSlug;
        saveRoomSession({
          ...message,
          gameTitle: view.gameTitle ?? session.gameTitle,
          ...(gameSlug === undefined ? {} : { gameSlug }),
        });
        navigate(`/table/${encodeURIComponent(message.roomId)}`, { replace: true });
      } else setNotice(message.message);
    });
  }, [client, navigate, session, view.gameSlug, view.gameTitle]);
  useEffect(() => {
    if (client === null || session === null) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = client.subscribeSocial((message) => {
      if (message.type === "chat_message") updateChat({ type: "message", message });
      else if (message.type === "cursor_update" && message.playerId !== session.playerId) {
        setRemoteCursors((old) => ({ ...old, [message.playerId]: { ...message, updatedAt: performance.now() } }));
      } else if (message.type === "table_ping") {
        const id = nextPingId.current++;
        const ping = { ...message, id, expiresAt: performance.now() + TABLE_PING_LIFETIME_MS };
        setRemotePings((old) => [...old, ping]);
        const timer = setTimeout(() => {
          timers.delete(timer);
          setRemotePings((old) => old.filter((item) => item.id !== id));
        }, TABLE_PING_LIFETIME_MS);
        timers.add(timer);
      }
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      setRemoteCursors({});
      setRemotePings([]);
    };
  }, [client, session]);
  useEffect(() => {
    if (view.correction === null) return;
    const id = view.correction.id;
    const timer = setTimeout(() => store.clearCorrection(id), 2_600);
    return () => clearTimeout(timer);
  }, [store, view.correction]);

  if (session === null || client === null) return <div className="join-status">
    <p className="eyebrow">Table session missing</p><h1>Use an invite to enter</h1>
    <p>This tab does not have a room token.</p><Link className="button-link" to="/">Go home</Link>
  </div>;

  const gameTitle = view.gameTitle ?? session.gameTitle;
  const dice = Object.values(view.state?.entities ?? {}).filter((entity) => entity.components.die !== undefined);
  const prompts = openPromptsForPlayer(view.state, session.playerId);
  const closePanel = () => choosePanel(null);
  const localSeatId = view.players.find((player) => player.playerId === session.playerId)?.seatId;
  const canSpawn = view.state?.settings.sandbox === true || view.state?.settings.allowSpawn === true;
  const timerSeconds = (prompt: PromptRecord) => {
    const timer = Object.values(view.state?.timers ?? {}).find((candidate) =>
      candidate.status === "scheduled" && (candidate.id.includes(prompt.id) || candidate.callback.includes(prompt.id)));
    return timer === undefined ? null : Math.ceil(timer.delay / 1000);
  };
  const withBusy = async (operation: () => Promise<{ ok: boolean; error?: { message: string } }>, success?: string) => {
    setBusy(true);
    const result = await operation();
    setBusy(false);
    if (!result.ok) setNotice(result.error?.message ?? "That action failed.");
    else if (success) setNotice(success);
  };
  const save = () => void withBusy(
    () => api.saveTable(roomId, session.roomToken, store.confirmedSnapshot() as GameSnapshotDto | undefined),
    "Table saved",
  );
  const objectsMenu = canSpawn ? <ObjectsMenu disabled={status.state !== "connected"} onSpawn={(libraryId) => {
    client.sendAction({
      type: "entity.spawn",
      payload: {
        libraryId,
        transform: {
          position: spawnPoint.current,
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    });
  }} /> : undefined;

  return <div className={`table-shell${settings.reducedMotion ? " table-shell--reduced-motion" : ""}`}
    style={{ "--table-ui-scale": settings.uiScale } as CSSProperties}>
    <TableScene
      store={store}
      client={client}
      playerId={session.playerId}
      interactionsPaused={status.state !== "connected"}
      graphicsQuality={settings.graphicsQuality}
      cameraSensitivity={settings.cameraSensitivity}
      invertCameraY={settings.invertCameraY}
      onProjectorChange={(next) => setProjectToTable(next === null ? undefined : () => next)}
      onScreenProjectorChange={(next) => setProjectFromTable(next === null ? null : () => next)}
      onTablePointerMove={(point) => {
        spawnPoint.current = { x: point.x, y: .08, z: point.z };
        client.sendCursorPosition({ x: point.x, z: point.z });
      }}
      onTablePing={(point) => client.sendTablePing({ x: point.x, z: point.z })}
      onRendererStatus={setRendererStatus}
      rendererStatus={rendererStatus}
      rendererOverrideActive={rendererOverrideActive}
      topBar={<TableMenuBar
        gameTitle={gameTitle}
        playerCount={view.players.length}
        isHost={host}
        activePanel={activePanel}
        mobileOpen={mobileMenu}
        unreadChat={chat.unread}
        onPanel={choosePanel}
        onSave={save}
        onToggleMobile={() => setMobileMenu((open) => !open)}
        {...(objectsMenu === undefined ? {} : { objectsMenu })}
      />}
      panels={<>
        {view.correction ? <div className="prediction-correction" role="status">{view.correction.message}</div> : null}
        {activePanel === "players" ? <PlayersPanel
          state={view.state} players={view.players} localPlayerId={session.playerId}
          patterns={settings.seatPatterns} disabled={status.state !== "connected"}
          onSeat={(seatId) => client.sendAction({ type: "seat.change", payload: { seatId } })}
          onKick={(playerId) => {
            if (confirm("Remove this player from the table?")) void withBusy(() => api.kickPlayer(roomId, session.roomToken, playerId));
          }}
          onPassHost={(playerId) => {
            if (confirm("Make this player the host?")) void withBusy(() => api.passHost(roomId, session.roomToken, playerId), "Host transferred");
          }}
          onClose={closePanel}
        /> : null}
        {activePanel === "rules" ? <RulesPanel rules={view.rules} slug={view.gameSlug ?? session.gameSlug ?? null} onClose={closePanel} /> : null}
        {activePanel === "log" ? <LogPanel lines={log} chatLines={chat.lines} onClose={closePanel} /> : null}
        {activePanel === "settings" ? <SettingsPanel onClose={closePanel} /> : null}
        {activePanel === "game" && host ? <GamePanel
          joinCode={session.joinCode} inviteUrl={session.inviteUrl} visibility={session.visibility ?? "private"} busy={busy}
          onVisibility={(visibility) => void withBusy(() => api.setRoomVisibility(roomId, session.roomToken, visibility), `Room is now ${visibility}`)}
          onRestart={() => { if (confirm("Restart with the same game and move everyone to a new room?")) void withBusy(() => api.restartTable(roomId, session.roomToken)); }}
          onEnd={() => { if (confirm("End this table for everyone?")) void withBusy(() => api.endTable(roomId, session.roomToken)); }}
          onClose={closePanel}
        /> : null}
        {activePanel === "help" ? <HelpPanel onClose={closePanel} diagnostics={<>
          <dt>Sequence</dt><dd>{view.state?.sequence ?? "—"}</dd>
          <dt>State hash</dt><dd>{view.stateHash ?? "—"}</dd>
          <dt>Transport</dt><dd>{status.state}</dd>
          <RendererDiagnostics status={rendererStatus} />
        </>} /> : null}
        <HandCountEdges state={view.state} players={view.players} localPlayerId={session.playerId} patterns={settings.seatPatterns} />
        <DiceControls dice={dice} definitions={view.definitions} disabled={status.state !== "connected"}
          onRoll={(entityId) => client.sendAction({ type: "die.roll", payload: { entityId } })} />
        {prompts.map((prompt) => <PromptTray key={prompt.id} prompt={prompt} countdown={timerSeconds(prompt)}
          disabled={status.state !== "connected"}
          respond={(response) => client.sendAction({ type: "prompt.respond", payload: { promptId: prompt.id, response } })} />)}
        <TableChat model={chat} disabled={status.state !== "connected"}
          onOpen={() => choosePanel("chat")} onClose={closePanel} onSend={(text) => client.sendChat(text)} />
        <HandStrip
          key={roomId}
          items={localHandItems(view.displayedState, session.playerId, view.definitions)}
          roomId={roomId}
          client={client}
          interactionsPaused={status.state !== "connected"}
          {...(localSeatId === null || localSeatId === undefined ? {} : { seatColor: seatPaletteEntry(localSeatId).color })}
          {...(projectToTable === undefined ? {} : { projectToTable })}
        />
        {notice ? <div className="table-toast" role="status">{notice}</div> : null}
      </>}
      overlay={<>
        <RemotePresenceOverlay cursors={Object.values(remoteCursors)} pings={remotePings} project={projectFromTable} />
        {status.state === "connected" ? null : <ConnectionOverlay
          status={status}
          gameTitle={gameTitle}
          {...(view.gameSlug ?? session.gameSlug ? { coverUrl: `/api/games/${encodeURIComponent(view.gameSlug ?? session.gameSlug!)}/cover` } : {})}
          onReload={() => {
            client.stop();
            setStatus(INITIAL_STATUS);
            setClientGeneration((value) => value + 1);
          }}
        />}
      </>}
    />
  </div>;
}
