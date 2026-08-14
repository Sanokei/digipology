import { describe, expect, test } from "bun:test";
import type { AiGameDraftResponse } from "digipology-protocol/http";
import {
  aiCreatePrefill,
  aiReleasePrefill,
  aiSubmitIntent,
  initialAiCreatorState,
  nextVisibility,
  ownedGameRoomSession,
  reduceAiCreator,
} from "./creatorModel";

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

describe("AI creator panel state", () => {
  const response = {
    draft: {
      title: "Clockwork Cards",
      minPlayers: 2,
      maxPlayers: 5,
      releaseId: "draft_clockwork_1",
    },
    validationReport: [{ check: "bundle_shape", ok: true }],
    telemetry: { attempts: 1, firstTryValid: true, retries: 0, fallback: false, violations: [] },
  } as unknown as AiGameDraftResponse;

  test("moves idle to busy to report/prefilled", () => {
    const busy = reduceAiCreator(initialAiCreatorState, { type: "requested" });
    expect(busy).toMatchObject({ phase: "busy", report: [] });
    const ready = reduceAiCreator(busy, { type: "succeeded", response });
    expect(ready).toMatchObject({ phase: "prefilled", report: [{ check: "bundle_shape", ok: true }] });
    expect(aiCreatePrefill(response, "A thoughtful card game")).toMatchObject({
      title: "Clockwork Cards", tagline: "A thoughtful card game", minPlayers: 2, maxPlayers: 5,
    });
    expect(aiReleasePrefill(response.draft)).toContain('"releaseId": "draft_clockwork_1"');
  });

  test("maps unconfigured, capped, and generation failures to calm explicit states", () => {
    expect(reduceAiCreator(initialAiCreatorState, {
      type: "failed", code: "ai_unconfigured", message: "not configured",
    }).phase).toBe("unconfigured");
    expect(reduceAiCreator(initialAiCreatorState, {
      type: "failed", code: "ai_daily_cap", message: "come back tomorrow",
    }).phase).toBe("capped");
    expect(reduceAiCreator(initialAiCreatorState, {
      type: "failed", code: "ai_generation_failed", message: "retry", report: [{ check: "kernel_load", ok: false }],
    })).toMatchObject({ phase: "failed", report: [{ check: "kernel_load", ok: false }] });
  });

  test("intercepts guests at the action site while keeping the action available", () => {
    expect(aiSubmitIntent(null, "Make a dice game")).toBe("sign_in");
    expect(aiSubmitIntent({ id: "user" }, "  ")).toBe("ignore");
    expect(aiSubmitIntent({ id: "user" }, "Make a dice game")).toBe("submit");
  });
});
