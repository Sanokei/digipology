import type { CreateRoomResponse, GameVisibility, OwnedGameDto } from "digipology-protocol/http";
import type { SavedRoomSession } from "../utils/roomSession";

export function nextVisibility(game: Pick<OwnedGameDto, "visibility">): GameVisibility {
  return game.visibility === "public" ? "unlisted" : "public";
}

export function ownedGameRoomSession(
  game: Pick<OwnedGameDto, "latestReleaseId" | "title">,
  room: CreateRoomResponse,
): SavedRoomSession {
  return { ...room, releaseId: game.latestReleaseId, gameTitle: game.title };
}

