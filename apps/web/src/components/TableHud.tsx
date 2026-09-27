import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CanonicalGameState } from "digipology-kernel";
import type { PlayerInfo } from "digipology-protocol";

import type { GameLogLine } from "../pages/tableLogModel";
import {
  currentTurnPlayerId,
  handCountsByPlayer,
  seatPickerSeats,
  tableMenuEntries,
  type TablePanelId,
} from "../pages/tableShellModel";
import { tableSettingsStore, useTableSettings } from "../state/tableSettings";

type IconName = "back" | "players" | "chat" | "rules" | "log" | "save" | "game" | "objects" | "settings" | "help" | "close" | "crown" | "cards" | "copy";

export function HudIcon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, ReactNode> = {
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></>,
    players: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-4 2.3-6 5.5-6s5.1 2 5.5 6" /><path d="M16 6.7a2.5 2.5 0 0 1 0 4.7M16 14c2.7.3 4 1.9 4.5 4.5" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    rules: <><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    log: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    save: <><path d="M5 4h12l2 2v14H5z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
    game: <><path d="M8 8h8l4 4-2 6-4-3h-4l-4 3-2-6z" /><path d="M8 11v4M6 13h4M15 12h.01M17 14h.01" /></>,
    objects: <><path d="m12 3 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.6 2.6 0 1 1 4.2 2c-1.2.8-1.8 1.3-1.8 2.5M12 17h.01" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    crown: <path d="m4 8 4 3 4-6 4 6 4-3-2 10H6z" />,
    cards: <><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 8h6" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  };
  return <svg className="hud-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name]}</svg>;
}

const ICONS: Record<string, IconName> = { players: "players", chat: "chat", rules: "rules", log: "log", save: "save", game: "game", objects: "objects", settings: "settings", help: "help" };

export function TableMenuBar({ gameTitle, playerCount, isHost, activePanel, mobileOpen, unreadChat, onPanel, onSave, onToggleMobile, objectsMenu }: {
  gameTitle: string; playerCount: number; isHost: boolean; activePanel: TablePanelId; mobileOpen: boolean; unreadChat: number;
  onPanel(panel: TablePanelId): void; onSave(): void; onToggleMobile(): void; objectsMenu?: ReactNode;
}) {
  const entries = tableMenuEntries(isHost);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLInputElement) || (event.target instanceof HTMLTextAreaElement)) return;
      const entry = entries.find((candidate) => candidate.shortcut?.toLowerCase() === event.key.toLowerCase());
      if (entry === undefined) return;
      event.preventDefault();
      if (entry.id !== "save" && entry.id !== "objects") onPanel(entry.id);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [entries, onPanel]);
  return <header className="table-hudbar">
    <div className="table-hudbar__identity"><Link to="/" aria-label="Leave table"><HudIcon name="back" /></Link><div><small>Live table</small><strong>{gameTitle}</strong></div></div>
    <nav className="table-hudbar__menu" aria-label="Table tools">{entries.map((entry) => entry.id === "objects" && objectsMenu !== undefined
      ? <div className="table-hudbar__slot" key={entry.id}>{objectsMenu}</div>
      : <button key={entry.id} type="button" aria-pressed={activePanel === entry.id} onClick={() => {
        if (entry.id === "save") onSave();
        else if (entry.id !== "objects") onPanel(activePanel === entry.id ? null : entry.id);
      }}><HudIcon name={ICONS[entry.id] ?? "help"} /><span>{entry.label}</span>{entry.id === "chat" && unreadChat > 0 ? <b>{Math.min(99, unreadChat)}</b> : null}</button>)}</nav>
    <button className="table-hudbar__mobile" type="button" aria-expanded={mobileOpen} onClick={onToggleMobile}><HudIcon name="game" /><span>{playerCount}</span></button>
    {mobileOpen ? <nav className="table-hudbar__sheet table-sheet" aria-label="Table tools">{entries.map((entry) =>
      entry.id === "objects" && objectsMenu !== undefined
        ? <div className="table-hudbar__slot" key={entry.id}>{objectsMenu}</div>
        : <button key={entry.id} type="button" onClick={() => {
          if (entry.id === "save") onSave(); else if (entry.id !== "objects") onPanel(entry.id);
          onToggleMobile();
        }}><HudIcon name={ICONS[entry.id] ?? "help"} /><span>{entry.label}</span></button>)}</nav> : null}
  </header>;
}

function Panel({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  return <aside className={`hud-panel table-sheet${wide ? " hud-panel--wide" : ""}`} aria-label={title}>
    <header><strong>{title}</strong><button type="button" onClick={onClose} aria-label={`Close ${title}`}><HudIcon name="close" /></button></header>
    <div className="hud-panel__body">{children}</div>
  </aside>;
}

export function PlayersPanel({ state, players, localPlayerId, patterns, disabled, onSeat, onKick, onPassHost, onClose }: {
  state: CanonicalGameState | null; players: readonly PlayerInfo[]; localPlayerId: string; patterns: boolean; disabled: boolean;
  onSeat(seatId: string | null): void; onKick(playerId: string): void; onPassHost(playerId: string): void; onClose(): void;
}) {
  const seats = seatPickerSeats(state, players, localPlayerId);
  const counts = handCountsByPlayer(state);
  const turn = currentTurnPlayerId(state);
  const localHost = players.find((player) => player.playerId === localPlayerId)?.host === true;
  return <Panel title="Players & seats" onClose={onClose} wide>
    <p className="hud-panel__lead">Choose a seat or spectate. You can move whenever a seat is open.</p>
    <div className="seat-map" aria-label="Seat picker"><div className="seat-map__table">Table</div>{seats.map((seat) => <button
      key={seat.id} type="button" disabled={disabled || !seat.available} aria-pressed={seat.selected}
      className={`${seat.selected ? "is-selected" : ""}${patterns ? ` seat-pattern-${seat.pattern}` : ""}`}
      style={{ left: `${seat.x}%`, top: `${seat.y}%`, "--seat-color": seat.color } as CSSProperties}
      onClick={() => onSeat(seat.id)}><span>{seat.occupant?.displayName ?? seat.id}</span></button>)}</div>
    <button className="hud-wide-button" type="button" disabled={disabled} onClick={() => onSeat(null)}>Spectate</button>
    <div className="player-list">{players.map((player, index) => <div className="player-list__row" key={player.playerId}>
      <i className={patterns ? `seat-swatch seat-pattern-${index % 4}` : "seat-swatch"} style={{ "--seat-color": seats.find((seat) => seat.id === player.seatId)?.color ?? "#7c8792" } as CSSProperties} />
      <span><strong>{player.displayName}{player.host ? <HudIcon name="crown" /> : null}</strong><small>{player.seatId ?? "Spectating"} · {counts.get(player.playerId) ?? 0} cards</small></span>
      <em className={player.connected ? "is-online" : ""}>{turn === player.playerId ? "Turn" : player.connected ? "Online" : "Away"}</em>
      {localHost && player.playerId !== localPlayerId ? <span className="player-list__actions"><button type="button" onClick={() => onPassHost(player.playerId)}>Make host</button><button type="button" onClick={() => onKick(player.playerId)}>Kick</button></span> : null}
    </div>)}</div>
  </Panel>;
}

export function HandCountEdges({ state, players, localPlayerId, patterns }: { state: CanonicalGameState | null; players: readonly PlayerInfo[]; localPlayerId: string; patterns: boolean }) {
  const counts = handCountsByPlayer(state);
  return <div className="hand-count-edges" aria-label="Other players' hands">{seatPickerSeats(state, players, localPlayerId).flatMap((seat) => {
    if (seat.occupant === null || seat.occupant.playerId === localPlayerId) return [];
    return [<div key={seat.id} className={patterns ? `seat-pattern-${seat.pattern}` : ""} style={{ left: `${seat.x}%`, top: `${seat.y}%`, "--seat-color": seat.color } as CSSProperties}><HudIcon name="cards" /><span>{seat.occupant.displayName}</span><b>{counts.get(seat.occupant.playerId) ?? 0}</b></div>];
  })}</div>;
}

function RulesText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return <div className="rules-copy">{blocks.map((block, index) => block.split("\n").every((line) => /^[-*] /.test(line))
    ? <ul key={index}>{block.split("\n").map((line, item) => <li key={item}>{line.replace(/^[-*] /, "")}</li>)}</ul>
    : <p key={index}>{block.replace(/^#{1,3}\s+/, "")}</p>)}</div>;
}

export function RulesPanel({ rules, slug, onClose }: { rules: string | null; slug: string | null; onClose(): void }) {
  return <Panel title="Rules" onClose={onClose}><RulesText text={rules?.trim() || "This release does not include a rules sheet yet."} />{slug === null ? null : <a className="hud-wide-button" href={`/docs/games/${encodeURIComponent(slug)}`}>Open full game guide</a>}</Panel>;
}

export function LogPanel({ lines, chatLines, onClose }: { lines: readonly GameLogLine[]; chatLines: readonly { id: number; message: { kind: string; text: string; displayName?: string } }[]; onClose(): void }) {
  const [includeChat, setIncludeChat] = useState(false);
  return <Panel title="Game log" onClose={onClose}><label className="hud-check"><input type="checkbox" checked={includeChat} onChange={(event) => setIncludeChat(event.currentTarget.checked)} /> Include chat</label><div className="game-log" aria-live="polite">
    {lines.length === 0 && (!includeChat || chatLines.length === 0) ? <p>No game events yet.</p> : lines.map((line) => <p className={`game-log__${line.tone}`} key={line.id}><small>#{line.sequence}</small>{line.text}</p>)}
    {includeChat ? chatLines.map((line) => <p key={`chat-${line.id}`}><small>Chat</small>{line.message.kind === "player" ? `${line.message.displayName ?? "Player"}: ` : ""}{line.message.text}</p>) : null}
  </div></Panel>;
}

export function SettingsPanel({ onClose }: { onClose(): void }) {
  const settings = useTableSettings();
  const set = tableSettingsStore.update.bind(tableSettingsStore);
  return <Panel title="Table settings" onClose={onClose}><div className="settings-grid">
    <label>Graphics quality<select value={settings.graphicsQuality} onChange={(event) => set({ graphicsQuality: event.currentTarget.value as "auto" | "high" | "low" })}><option value="auto">Auto</option><option value="high">High</option><option value="low">Low</option></select></label>
    <label>UI scale <output>{Math.round(settings.uiScale * 100)}%</output><input type="range" min="0.8" max="1.3" step="0.05" value={settings.uiScale} onChange={(event) => set({ uiScale: Number(event.currentTarget.value) })} /></label>
    <label>Camera sensitivity <output>{settings.cameraSensitivity.toFixed(1)}×</output><input type="range" min="0.5" max="2" step="0.1" value={settings.cameraSensitivity} onChange={(event) => set({ cameraSensitivity: Number(event.currentTarget.value) })} /></label>
    <label>Sound <output>{Math.round(settings.soundVolume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={settings.soundVolume} onChange={(event) => set({ soundVolume: Number(event.currentTarget.value) })} /></label>
    <label className="hud-check"><input type="checkbox" checked={settings.muted} onChange={(event) => set({ muted: event.currentTarget.checked })} /> Mute sound</label>
    <label className="hud-check"><input type="checkbox" checked={settings.invertCameraY} onChange={(event) => set({ invertCameraY: event.currentTarget.checked })} /> Invert camera Y</label>
    <label className="hud-check"><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => set({ reducedMotion: event.currentTarget.checked })} /> Reduce motion</label>
    <label className="hud-check"><input type="checkbox" checked={settings.seatPatterns} onChange={(event) => set({ seatPatterns: event.currentTarget.checked })} /> Seat color patterns</label>
  </div></Panel>;
}

export function GamePanel({ joinCode, inviteUrl, visibility, busy, onVisibility, onRestart, onEnd, onClose }: {
  joinCode: string; inviteUrl: string; visibility: "private" | "public"; busy: boolean; onVisibility(value: "private" | "public"): void; onRestart(): void; onEnd(): void; onClose(): void;
}) {
  const [copied, setCopied] = useState(false);
  return <Panel title="Game" onClose={onClose}><p className="hud-panel__lead">Invite code <strong>{joinCode}</strong></p><button className="hud-wide-button" type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true)).catch(() => setCopied(false))}><HudIcon name="copy" />{copied ? "Copied invite" : "Copy invite link"}</button>
    <fieldset className="hud-segmented"><legend>Room visibility</legend><button type="button" aria-pressed={visibility === "private"} onClick={() => onVisibility("private")}>Private</button><button type="button" aria-pressed={visibility === "public"} onClick={() => onVisibility("public")}>Public</button></fieldset>
    <button className="hud-wide-button" type="button" disabled={busy} onClick={onRestart}>Restart in a new room</button><button className="hud-wide-button hud-danger" type="button" disabled={busy} onClick={onEnd}>End table for everyone</button>
  </Panel>;
}

export function HelpPanel({ onClose, diagnostics }: { onClose(): void; diagnostics: ReactNode }) {
  return <Panel title="Help & diagnostics" onClose={onClose}><dl className="hud-diagnostics">{diagnostics}</dl><p>Mouse: drag pieces, right-click for actions, wheel to zoom. Touch: drag pieces, pinch to zoom, long-press for actions.</p><Link className="hud-wide-button" to="/docs/playing">Playing guide</Link></Panel>;
}
