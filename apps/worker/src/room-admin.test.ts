import { describe, expect, test } from "bun:test";
import { authorizeHostCommand, validatedSeatChange } from "./room-admin";

describe("room administration authorization", () => {
  test("requires the host for kick and redirect commands", () => {
    expect(authorizeHostCommand(null, "host", "guest")).toBe("unauthorized");
    expect(authorizeHostCommand("guest", "host", "other")).toBe("host_only");
    expect(authorizeHostCommand("host", "host", "host")).toBe("invalid_target");
    expect(authorizeHostCommand("host", "host", "guest")).toBe("allowed");
    expect(authorizeHostCommand("host", "host")).toBe("allowed");
  });

  test("accepts only known vacant seats and spectate", () => {
    const seats = new Set(["red", "blue"]);
    const occupants = new Map([["red", "alice"]]);
    expect(validatedSeatChange("alice", { seatId: "red" }, seats, occupants)).toEqual({ accepted: true, seatId: "red" });
    expect(validatedSeatChange("bob", { seatId: "red" }, seats, occupants)).toEqual({ accepted: false });
    expect(validatedSeatChange("bob", { seatId: "blue" }, seats, occupants)).toEqual({ accepted: true, seatId: "blue" });
    expect(validatedSeatChange("bob", { seatId: null }, seats, occupants)).toEqual({ accepted: true, seatId: null });
    expect(validatedSeatChange("bob", { seatId: "missing" }, seats, occupants)).toEqual({ accepted: false });
    expect(validatedSeatChange("bob", { seatId: "blue", extra: true }, seats, occupants)).toEqual({ accepted: false });
  });
});
