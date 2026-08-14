import type { SavedRoomSession } from "../utils/roomSession";

export type QuickPlayState =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "success"; session: SavedRoomSession; navigateTo: string }
  | { phase: "error"; toast: string };

export type QuickPlayAction =
  | { type: "activate" }
  | { type: "succeeded"; session: SavedRoomSession }
  | { type: "failed"; message: string }
  | { type: "reset" };

export const initialQuickPlayState: QuickPlayState = { phase: "idle" };

export function quickPlayReducer(state: QuickPlayState, action: QuickPlayAction): QuickPlayState {
  switch (action.type) {
    case "activate":
      return state.phase === "pending" || state.phase === "success" ? state : { phase: "pending" };
    case "succeeded":
      return state.phase === "pending"
        ? { phase: "success", session: action.session, navigateTo: `/table/${encodeURIComponent(action.session.roomId)}` }
        : state;
    case "failed":
      return state.phase === "pending" ? { phase: "error", toast: action.message } : state;
    case "reset":
      return { phase: "idle" };
  }
}
