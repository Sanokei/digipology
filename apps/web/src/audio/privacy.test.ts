import { expect, test } from "bun:test";
import { createInitialState, type KernelEvent, type PromptRecord } from "digipology-kernel";
import { cuesForEvents } from "./cues";

function state() {
  const value = createInitialState({ releaseId: "sound-privacy", rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 }, entities: {
    deck: { id: "deck", components: { container: { items: ["card"], capacity: null, ordering: "ordered", visibility: "public" } } },
    hand: { id: "hand", components: { hand: { owner: "seat_2", canonicalOrder: true }, container: { items: [], capacity: null, ordering: "ordered", visibility: "owner:seat_2" } } },
    card: { id: "card", components: {} },
  } });
  value.seats.seat_2 = { id: "seat_2", playerId: "bob" };
  return value;
}
const event = (type: string, data: KernelEvent["data"]): KernelEvent => ({ type, data, sequence: 1, actionId: "confirmed" });

test("private owner-by-seat draws and flips sound only for that seat, never another listener", () => {
  const before = state(), after = structuredClone(before);
  after.entities.deck!.components.container!.items = []; after.entities.hand!.components.container!.items = ["card"];
  const draw = event("deck.drawn", { deckId: "deck", target: "hand", items: ["card"], count: 1 });
  expect(cuesForEvents([draw], { before, after, playerId: "bob" })).toEqual(["card"]);
  expect(cuesForEvents([draw], { before, after, playerId: "alice" })).toEqual([]);
  const flip = event("entity.flipped", { entityId: "card", flipped: true });
  expect(cuesForEvents([flip], { before: after, after, playerId: "bob" })).toEqual(["card"]);
  expect(cuesForEvents([flip], { before: after, after, playerId: "alice" })).toEqual([]);
});
test("nested private membership, cyclic containers and unknown visibility fail closed", () => {
  const value = state(); value.entities.hand!.components.container!.items = ["deck"];
  const cue = event("entity.flipped", { entityId: "card" });
  expect(cuesForEvents([cue], { before: value, after: value, playerId: "alice" })).toEqual([]);
  expect(cuesForEvents([cue], { before: value, after: value, playerId: "bob" })).toEqual(["card"]);
  value.entities.hand!.components.container!.items = ["deck", "hand"];
  expect(cuesForEvents([cue], { before: value, after: value, playerId: "bob" })).toEqual([]);
  value.entities.hand!.components.container!.items = []; value.entities.deck!.components.container!.visibility = "secret";
  expect(cuesForEvents([cue], { before: value, after: value, playerId: "bob" })).toEqual([]);
});
test("prompt creation only notifies its actual recipient; missing context or targets produce no cue", () => {
  const value = state(); value.prompts.choice = { id: "choice", playerId: "bob", kind: "confirm", title: "Private", status: "open" } as PromptRecord;
  const prompt = event("prompt.created", { id: "choice", playerId: "bob", title: "Private" });
  expect(cuesForEvents([prompt], { before: value, after: value, playerId: "alice" })).toEqual([]);
  expect(cuesForEvents([prompt], { before: value, after: value, playerId: "bob" })).toEqual(["choice"]);
  expect(cuesForEvents([prompt])).toEqual([]);
  expect(cuesForEvents([event("entity.flipped", { entityId: "missing" })], { before: value, after: value, playerId: "bob" })).toEqual([]);
});
test("public events remain audible; a transfer touching an unrevealed destination is suppressed", () => {
  const before = state(), after = structuredClone(before);
  const shuffle = event("deck.shuffled", { deckId: "deck" });
  expect(cuesForEvents([shuffle, shuffle], { before, after, playerId: "alice" })).toEqual(["shuffle"]);
  after.entities.deck!.components.container!.items = []; after.entities.hand!.components.container!.items = ["card"];
  expect(cuesForEvents([event("entity.dropped", { entityId: "card" })], { before, after, playerId: "alice" })).toEqual([]);
});
test("a public piece cannot reveal a private snap destination through a placement sound", () => {
  const value = state(); value.entities.slot = { id: "slot", components: {} }; value.entities.hand!.components.container!.items = ["slot"];
  const snap = event("snap.attached", { entityId: "card", snapPointId: "slot" });
  expect(cuesForEvents([snap], { before: value, after: value, playerId: "alice" })).toEqual([]);
  expect(cuesForEvents([snap], { before: value, after: value, playerId: "bob" })).toEqual(["place"]);
});
