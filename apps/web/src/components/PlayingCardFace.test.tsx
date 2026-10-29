import { expect, test } from "bun:test";
import { playingCardIdentity } from "./playingCardIdentity";

test("card markings use the explicit named deck and preserve custom and archived identities", () => {
  expect(playingCardIdentity("standard_v2_diamonds_7", "7 of Diamonds")).toEqual({ rank: "7", suit: "diamonds" });
  expect(playingCardIdentity("standard_v2_clubs_q", "Queen of Clubs")).toEqual({ rank: "Q", suit: "clubs" });
  expect(playingCardIdentity("standard_20", "Card")).toBeNull();
  expect(playingCardIdentity("standard_v2_diamonds_7", "Launch the lighthouse")).toBeNull();
});
