import { describe, expect, it } from "bun:test";

import type { SavedRoomSession } from "../utils/roomSession";
import { initialQuickPlayState, quickPlayReducer } from "./quickPlayModel";

const session: SavedRoomSession = {
  roomId: "room/44",
  joinCode: "ABCD-EFGH",
  inviteUrl: "https://play.digipology.com/join/ABCD-EFGH",
  playerId: "player-1",
  roomToken: "token",
  wsUrl: "wss://example.test",
  releaseId: "release-1",
  gameTitle: "Signal Fire",
};

describe("quickPlayReducer", () => {
  it("moves idle to pending to success with navigation and session intents", () => {
    const pending = quickPlayReducer(initialQuickPlayState, { type: "activate" });
    expect(pending).toEqual({ phase: "pending" });
    expect(quickPlayReducer(pending, { type: "succeeded", session })).toEqual({
      phase: "success",
      session,
      navigateTo: "/table/room%2F44",
    });
  });

  it("makes duplicate activation while pending a no-op", () => {
    const pending = quickPlayReducer(initialQuickPlayState, { type: "activate" });
    expect(quickPlayReducer(pending, { type: "activate" })).toBe(pending);
  });

  it("exposes an error toast intent and can recover to idle", () => {
    const pending = quickPlayReducer(initialQuickPlayState, { type: "activate" });
    const failed = quickPlayReducer(pending, { type: "failed", message: "Try again" });
    expect(failed).toEqual({ phase: "error", toast: "Try again" });
    expect(quickPlayReducer(failed, { type: "reset" })).toEqual(initialQuickPlayState);
  });
});
