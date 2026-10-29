import { expect, test } from "bun:test";
import { applyOrdered, snapshot, type GameSnapshot, type OrderedActionInput } from "digipology-kernel";
import { getBuiltinRelease } from "digipology-demo-games";
import { localHandItems } from "../../web/src/pages/tableHandModel";
import { piecePresentation } from "../../web/src/scene/piecePresentation";
import { builtinCatalog } from "./catalog";
import { createBuiltinInitialState } from "./initial-state";
import type { FirstDealV2Card } from "../../../packages/demo-games/src/games/first-deal/cards-v2";
import replay from "../../../packages/demo-games/fixtures/first-deal-replay-v2.json";

const fixture = replay as unknown as {
  initialSnapshot: GameSnapshot;
  actions: OrderedActionInput<unknown>[];
  expectedEventTypes: string[];
  expectedPlayedCardId: string;
  expectedPlayedCardLabel: string;
  expectedPrivateHandLabels: { alice: string[]; bob: string[] };
  expectedFinalStateHash: string;
};
const roster = [{ playerId: "alice", displayName: "Alice" }, { playerId: "bob", displayName: "Bob" }];

test("First Deal v2 authors a complete named deck without assigning identities to v1", () => {
  const current = builtinCatalog.resolveRelease("first-deal")!.bundle;
  expect(current.releaseId).toBe("builtin_first_deal_2");
  const file = current.files.find((candidate) => candidate.path === "runtime/cards.json")!;
  const cards = (JSON.parse(file.content) as { cards: FirstDealV2Card[] }).cards;
  expect(cards).toHaveLength(52);
  for (const field of ["entityId", "definitionId", "label"] as const) {
    expect(new Set(cards.map((card) => card[field])).size).toBe(52);
  }
  for (const suit of ["clubs", "diamonds", "hearts", "spades"]) {
    expect(cards.filter((card) => card.suit === suit).map((card) => card.rank))
      .toEqual(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
  }
  const initial = createBuiltinInitialState(current.releaseId, roster)!;
  expect(initial.entities.deck!.components.container!.items).toEqual(cards.map((card) => card.entityId));
  for (const card of cards) {
    expect(initial.entities[card.entityId]!.components.card!.definitionId).toBe(card.definitionId);
    expect(current.definitions?.[card.definitionId]).toEqual({ label: card.label, color: card.color });
    expect(card.color).toMatch(/^#[0-9a-f]{6}$/);
  }
  expect(cards[0]!.label).toBe("Ace of Clubs");
  expect(cards.at(-1)!.label).toBe("King of Spades");
  expect(current.files.find((candidate) => candidate.path === "runtime/rules.md")?.content)
    .toContain("52 distinct cards and no jokers");
  const legacy = getBuiltinRelease("builtin_first_deal_1")!;
  expect(legacy.definitions).toBeUndefined();
  expect(legacy.integrity.manifestHash).toBe("sha256:28e79d8c4c4f5c60154e21ed7784b68de7f025c3df9f0badc6deb4aff5a2c0ea");
  expect(createBuiltinInitialState(legacy.releaseId, roster)!.entities.card_52!.components.card!.definitionId)
    .toBe("standard_52");
});

test("named draws, private hands, visible center play, and reveal replay to a frozen result", () => {
  const bundle = builtinCatalog.getRelease("builtin_first_deal_2")!.bundle;
  const definitions = bundle.definitions!;
  let state = createBuiltinInitialState(bundle.releaseId, roster)!;
  expect(snapshot(state)).toEqual(fixture.initialSnapshot);
  const events = new Set<string>();
  for (const action of fixture.actions) {
    const result = applyOrdered(state, action);
    expect(result.rejection).toBeUndefined();
    for (const event of result.events) events.add(event.type);
    state = result.state;
    if (action.action.type === "deck.draw_to_container" && action.actor.type === "player" && action.actor.playerId === "alice") {
      expect(localHandItems(state, "alice", definitions).map((card) => card.label))
        .toEqual(["7 of Diamonds", "Queen of Clubs"]);
      expect(localHandItems(state, "bob", definitions)).toEqual([]);
    }
    if (action.action.type === "entity.drop") {
      const card = state.entities[fixture.expectedPlayedCardId]!;
      expect(Object.values(state.entities).some((entity) => entity.components.container?.items.includes(card.id)))
        .toBe(false);
      const deck = state.entities.deck!;
      const deckWidth = piecePresentation(deck).width;
      const cardWidth = piecePresentation(card).width;
      const distance = Math.abs(deck.components.transform!.position.x - card.components.transform!.position.x);
      expect(distance).toBeGreaterThan((deckWidth + cardWidth) / 2);
      expect(piecePresentation(card, definitions[card.components.card!.definitionId]).label).toBe("Face-down card");
    }
  }
  expect([...events].sort()).toEqual(fixture.expectedEventTypes);
  expect(localHandItems(state, "alice", definitions).map((card) => card.label))
    .toEqual(fixture.expectedPrivateHandLabels.alice);
  expect(localHandItems(state, "bob", definitions).map((card) => card.label))
    .toEqual(fixture.expectedPrivateHandLabels.bob);
  const played = state.entities[fixture.expectedPlayedCardId]!;
  expect(piecePresentation(played, definitions[played.components.card!.definitionId]).label)
    .toBe(fixture.expectedPlayedCardLabel);
  expect(snapshot(state).stateHash).toBe(fixture.expectedFinalStateHash);
});

test("hand rendering keeps a custom game's authored labels instead of guessing from definition IDs", () => {
  let state = createBuiltinInitialState("builtin_first_deal_2", roster)!;
  state = applyOrdered(state, { sequence: 1, actionId: "start", actor: { type: "system" }, action: { type: "system.game_start", payload: {} } }).state;
  state = applyOrdered(state, { sequence: 2, actionId: "draw", actor: { type: "player", playerId: "alice" }, action: { type: "deck.draw_to_container", payload: { deckId: "deck", target: "hand_seat_1", count: 1 } } }).state;
  const cardId = state.entities.hand_seat_1!.components.container!.items[0]!;
  const definitionId = state.entities[cardId]!.components.card!.definitionId;
  const before = snapshot(state).stateHash;
  const custom = localHandItems(state, "alice", { [definitionId]: { label: "Launch the lighthouse", color: "#e1d9c8" } });
  expect(custom[0]).toMatchObject({ entityId: cardId, label: "Launch the lighthouse", color: "#e1d9c8" });
  expect(localHandItems(state, "bob", { [definitionId]: { label: "Launch the lighthouse" } })).toEqual([]);
  expect(snapshot(state).stateHash).toBe(before);
});
