export interface SavedRoomSession {
  roomId: string;
  joinCode: string;
  inviteUrl: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
  releaseId: string;
  gameTitle: string;
}

const roomKey = (roomId: string) => `digipology.room.${roomId}`;

export function saveRoomSession(session: SavedRoomSession): void {
  sessionStorage.setItem(roomKey(session.roomId), JSON.stringify(session));
}

export function loadRoomSession(roomId: string): SavedRoomSession | null {
  const raw = sessionStorage.getItem(roomKey(roomId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedRoomSession>;
    return value.roomId === roomId && typeof value.roomToken === "string" && typeof value.releaseId === "string"
      ? value as SavedRoomSession
      : null;
  } catch { return null; }
}

export function guestDisplayName(): string | null {
  return sessionStorage.getItem("digipology.guestDisplayName");
}

export function saveGuestDisplayName(name: string): void {
  sessionStorage.setItem("digipology.guestDisplayName", name);
}
