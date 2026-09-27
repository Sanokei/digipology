export type HostCommandAuthorization = "allowed" | "unauthorized" | "host_only" | "invalid_target";

export function authorizeHostCommand(
  requesterPlayerId: string | null,
  hostPlayerId: string | null,
  targetPlayerId?: string,
): HostCommandAuthorization {
  if (requesterPlayerId === null) return "unauthorized";
  if (requesterPlayerId !== hostPlayerId) return "host_only";
  if (targetPlayerId !== undefined && (targetPlayerId.length === 0 || targetPlayerId === requesterPlayerId)) {
    return "invalid_target";
  }
  return "allowed";
}

export function validatedSeatChange(
  playerId: string,
  payload: unknown,
  knownSeatIds: ReadonlySet<string>,
  occupants: ReadonlyMap<string, string>,
): { accepted: true; seatId: string | null } | { accepted: false } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { accepted: false };
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, "seatId")) {
    return { accepted: false };
  }
  const seatId = record.seatId;
  if (seatId === null) return { accepted: true, seatId: null };
  if (typeof seatId !== "string" || !knownSeatIds.has(seatId)) return { accepted: false };
  const occupant = occupants.get(seatId);
  return occupant === undefined || occupant === playerId
    ? { accepted: true, seatId }
    : { accepted: false };
}
