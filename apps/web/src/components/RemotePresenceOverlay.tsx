import { useEffect, useState, type CSSProperties } from "react";
import type { CursorUpdateMessage, TablePingMessage } from "digipology-protocol";

import { seatColor } from "../scene/piecePresentation";
import { REMOTE_CURSOR_IDLE_MS } from "../pages/tableSocialModel";

export interface RemoteCursor extends CursorUpdateMessage { updatedAt: number }
export interface RemotePing extends TablePingMessage { id: number; expiresAt: number }

export function RemotePresenceOverlay({
  cursors,
  pings,
  project,
}: {
  cursors: readonly RemoteCursor[];
  pings: readonly RemotePing[];
  project: ((point: { x: number; y: number; z: number }) => { x: number; y: number } | null) | null;
}) {
  const [now, setNow] = useState(() => performance.now());
  const activeUntil = Math.max(
    0,
    ...cursors.map((cursor) => cursor.updatedAt + REMOTE_CURSOR_IDLE_MS),
    ...pings.map((ping) => ping.expiresAt),
  );
  useEffect(() => {
    if (activeUntil <= performance.now()) return;
    const timer = setInterval(() => {
      const current = performance.now();
      setNow(current);
      if (current >= activeUntil) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [activeUntil]);
  if (project === null) return null;
  return <div className="remote-presence" aria-hidden="true">
    {cursors.filter((cursor) => now - cursor.updatedAt < REMOTE_CURSOR_IDLE_MS).map((cursor) => {
      const screen = project({ x: cursor.x, y: 0, z: cursor.z });
      if (screen === null) return null;
      const color = seatColor(cursor.seatId ?? cursor.playerId);
      return <div className="remote-cursor" key={cursor.playerId} style={{ left: screen.x, top: screen.y, "--presence-color": color } as CSSProperties}>
        <i /><span>{cursor.displayName}</span>
      </div>;
    })}
    {pings.filter((ping) => ping.expiresAt > now).map((ping) => {
      const screen = project({ x: ping.x, y: 0, z: ping.z });
      if (screen === null) return null;
      const color = seatColor(ping.seatId ?? ping.playerId);
      return <div className="remote-ping" key={ping.id} style={{ left: screen.x, top: screen.y, "--presence-color": color } as CSSProperties}><i /><span>{ping.displayName}</span></div>;
    })}
  </div>;
}
