export interface SeatPaletteEntry { readonly name: string; readonly color: string; readonly textColor: string }

/** Ten visually distinct seat identities, ordered for stable seat_1..seat_10 assignment. */
export const SEAT_PALETTE: readonly SeatPaletteEntry[] = Object.freeze([
  { name: "White", color: "#f2f2ed", textColor: "#17211d" },
  { name: "Red", color: "#d94b4b", textColor: "#ffffff" },
  { name: "Orange", color: "#e8892f", textColor: "#17211d" },
  { name: "Yellow", color: "#e5c849", textColor: "#17211d" },
  { name: "Green", color: "#4f9b58", textColor: "#ffffff" },
  { name: "Teal", color: "#32a6a0", textColor: "#17211d" },
  { name: "Blue", color: "#3679c9", textColor: "#ffffff" },
  { name: "Purple", color: "#8064c6", textColor: "#ffffff" },
  { name: "Pink", color: "#d66fa2", textColor: "#17211d" },
  { name: "Brown", color: "#8a6545", textColor: "#ffffff" },
]);

export function seatPaletteIndex(seatId: string): number {
  const numbered = /(?:^|[_-])seat[_-]?(\d+)(?:[_-]|$)/i.exec(seatId) ?? /(?:^|[_-])(\d+)(?:[_-]|$)/.exec(seatId);
  if (numbered !== null) return Math.max(0, Number.parseInt(numbered[1]!, 10) - 1) % SEAT_PALETTE.length;
  let hash = 2166136261;
  for (const character of seatId) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return (hash >>> 0) % SEAT_PALETTE.length;
}

export function seatPaletteEntry(seatId: string): SeatPaletteEntry {
  return SEAT_PALETTE[seatPaletteIndex(seatId)]!;
}
