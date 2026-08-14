import { describe, expect, test } from "bun:test";
import {
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  validateRequestMagicLinkRequest,
  validateUpdateMeRequest,
} from "./http";

describe("HTTP v1 request validators", () => {
  test("validates magic-link request bodies", () => {
    expect(validateRequestMagicLinkRequest({ email: "player@example.com" })).toEqual({
      ok: true,
      value: { email: "player@example.com" },
    });
    for (const value of [
      {},
      { email: 7 },
      { email: "missing-at.example.com" },
      { email: "a@b" },
      { email: `${"a".repeat(250)}@b.com` },
      { email: "player@example.com", password: "forbidden" },
    ]) {
      expect(validateRequestMagicLinkRequest(value).ok).toBe(false);
    }
  });

  test("validates profile names and rejects missing, wrong, empty, oversized, and extra fields", () => {
    expect(validateUpdateMeRequest({ name: "  Alice  " }).ok).toBe(true);
    for (const value of [
      {},
      { name: 1 },
      { name: "   " },
      { name: "x".repeat(65) },
      { name: "Alice", id: "client-controlled" },
    ]) {
      expect(validateUpdateMeRequest(value).ok).toBe(false);
    }
  });

  test("validates room creation bodies", () => {
    expect(
      validateCreateRoomRequest({
        releaseSlugOrId: "tabletop-sandbox",
        visibility: "private",
        displayName: "Host",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateCreateRoomRequest({ releaseSlugOrId: "release_1", visibility: "public" }),
    ).toMatchObject({ ok: true });
    for (const value of [
      {},
      { releaseSlugOrId: 1, visibility: "private" },
      { releaseSlugOrId: "", visibility: "private" },
      { releaseSlugOrId: "x".repeat(129), visibility: "private" },
      { releaseSlugOrId: "game", visibility: "friends" },
      { releaseSlugOrId: "game", visibility: "private", displayName: false },
      { releaseSlugOrId: "game", visibility: "private", ownerId: "spoofed" },
    ]) {
      expect(validateCreateRoomRequest(value).ok).toBe(false);
    }
  });

  test("validates join bodies against the v1 code field", () => {
    expect(validateJoinRoomRequest({ code: "abcd-2345", displayName: "Guest" })).toEqual({
      ok: true,
      value: { code: "abcd-2345", displayName: "Guest" },
    });
    for (const value of [
      {},
      { joinCode: "ABCD-2345" },
      { code: 42 },
      { code: "" },
      { code: "x".repeat(33) },
      { code: "ABCD-2345", displayName: "" },
      { code: "ABCD-2345", playerId: "spoofed" },
    ]) {
      expect(validateJoinRoomRequest(value).ok).toBe(false);
    }
  });
});
