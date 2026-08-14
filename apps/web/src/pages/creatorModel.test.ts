import { describe, expect, test } from "bun:test";
import { nextVisibility, ownedGameRoomSession } from "./creatorModel";

describe("My Games actions", () => {
  test("toggles only between public and unlisted", () => {
    expect(nextVisibility({ visibility: "public" })).toBe("unlisted");
    expect(nextVisibility({ visibility: "unlisted" })).toBe("public");
  });

  test("Host pins the latest immutable release into the saved room session", () => {
    expect(ownedGameRoomSession(
      { title: "Community Dice", latestReleaseId: "release_latest" },
      { roomId: "room", joinCode: "ABCD-EFGH", inviteUrl: "/join/ABCD-EFGH", playerId: "p1", roomToken: "token", wsUrl: "wss://example/ws" },
    )).toMatchObject({ releaseId: "release_latest", gameTitle: "Community Dice", roomId: "room" });
  });
});

