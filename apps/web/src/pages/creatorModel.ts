import type {
  AiGameDraftResponse,
  CreateRoomResponse,
  GameVisibility,
  OwnedGameDto,
  ReleaseBundleDto,
  UploadValidationReportItem,
} from "digipology-protocol/http";
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

export type AiCreatorPhase = "idle" | "busy" | "prefilled" | "unconfigured" | "capped" | "failed";

export interface AiCreatorState {
  phase: AiCreatorPhase;
  report: UploadValidationReportItem[];
  message: string | null;
}

export type AiCreatorEvent =
  | { type: "requested" }
  | { type: "succeeded"; response: AiGameDraftResponse }
  | { type: "failed"; code: string; message: string; report?: UploadValidationReportItem[] }
  | { type: "reset" };

export const initialAiCreatorState: AiCreatorState = {
  phase: "idle",
  report: [],
  message: null,
};

export function reduceAiCreator(state: AiCreatorState, event: AiCreatorEvent): AiCreatorState {
  switch (event.type) {
    case "requested":
      return { phase: "busy", report: [], message: "Building and validating your draft…" };
    case "succeeded":
      return {
        phase: "prefilled",
        report: event.response.validationReport,
        message: "Draft ready. Review it in the normal upload form before publishing.",
      };
    case "failed": {
      const phase = event.code === "ai_unconfigured"
        ? "unconfigured"
        : event.code === "ai_daily_cap"
          ? "capped"
          : "failed";
      return { phase, report: event.report ?? [], message: event.message };
    }
    case "reset":
      return initialAiCreatorState;
  }
}

export function aiSubmitIntent(
  user: unknown | null,
  text: string,
): "sign_in" | "submit" | "ignore" {
  if (user === null) return "sign_in";
  return text.trim() === "" ? "ignore" : "submit";
}

export interface AiCreatePrefill {
  title: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  bundleText: string;
}

export function aiCreatePrefill(
  response: AiGameDraftResponse,
  originalPrompt: string,
): AiCreatePrefill {
  return {
    title: response.draft.title ?? "Untitled game",
    tagline: promptTagline(originalPrompt),
    minPlayers: response.draft.minPlayers,
    maxPlayers: response.draft.maxPlayers,
    bundleText: JSON.stringify(response.draft, null, 2),
  };
}

export function aiReleasePrefill(draft: ReleaseBundleDto): string {
  return JSON.stringify(draft, null, 2);
}

function promptTagline(prompt: string): string {
  const compact = prompt.trim().replaceAll(/\s+/g, " ");
  if (compact.length <= 240) return compact;
  return compact.slice(0, 239).trimEnd() + "…";
}
