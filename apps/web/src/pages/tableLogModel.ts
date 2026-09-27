import type { KernelEvent } from "digipology-kernel";
import type { PlayerInfo } from "digipology-protocol";

export interface GameLogLine {
  id: string;
  sequence: number;
  text: string;
  tone: "normal" | "important" | "error";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function playerName(id: unknown, players: readonly PlayerInfo[]): string {
  const playerId = text(id);
  return playerId === null ? "A player" : players.find((player) => player.playerId === playerId)?.displayName ?? playerId;
}

export function formatKernelEvent(
  event: KernelEvent,
  players: readonly PlayerInfo[],
  host: boolean,
): GameLogLine | null {
  const data = event.data;
  const who = playerName(data.playerId, players);
  let line: Pick<GameLogLine, "text" | "tone"> | null = null;
  switch (event.type) {
    case "game.started": line = { text: "The game started.", tone: "important" }; break;
    case "game.resumed": line = { text: "The saved game resumed.", tone: "important" }; break;
    case "player.joined": line = { text: `${who} joined the table.`, tone: "normal" }; break;
    case "player.left": line = { text: `${who} left the table.`, tone: "normal" }; break;
    case "seat.assigned": line = { text: `${who} moved to ${text(data.seatId) ?? "a seat"}.`, tone: "normal" }; break;
    case "deck.drawn": {
      const count = Array.isArray(data.items) ? data.items.length : Array.isArray(data.drawn) ? data.drawn.length : 1;
      line = { text: `${who} drew ${count} card${count === 1 ? "" : "s"}.`, tone: "normal" };
      break;
    }
    case "die.rolled": line = { text: `${who} rolled ${String(data.value ?? "a die")}.`, tone: "important" }; break;
    case "entity.flipped": line = { text: `${who} flipped a piece.`, tone: "normal" }; break;
    case "deck.shuffled": line = { text: `${who} shuffled a deck.`, tone: "normal" }; break;
    case "container.moved": line = { text: `${who} moved a piece${text(data.to) === null ? " to the table" : " to a zone"}.`, tone: "normal" }; break;
    case "zone.entered": line = { text: `${who} moved a piece into ${text(data.zoneId) ?? "a zone"}.`, tone: "normal" }; break;
    case "prompt.responded": line = { text: `${who} answered a prompt.`, tone: "normal" }; break;
    case "script.error":
      if (host) line = { text: `Script error: ${text(data.message) ?? "unknown script failure"}`, tone: "error" };
      break;
    case "action.rejected":
      if (host) line = { text: `Action rejected: ${text(data.reason) ?? "invalid action"}`, tone: "error" };
      break;
  }
  return line === null ? null : { ...line, id: `${event.sequence}:${event.actionId}:${event.type}`, sequence: event.sequence };
}

export function appendGameLog(
  previous: readonly GameLogLine[],
  events: readonly KernelEvent[],
  players: readonly PlayerInfo[],
  host: boolean,
  limit = 200,
): GameLogLine[] {
  const seen = new Set(previous.map((line) => line.id));
  const added = events.flatMap((event) => {
    const line = formatKernelEvent(event, players, host);
    return line === null || seen.has(line.id) ? [] : [line];
  });
  return [...previous, ...added].slice(-limit);
}
