import type { ComponentDefinition } from "./types";

export const componentRegistry: Readonly<Record<string, ComponentDefinition>> =
  Object.freeze({
    transform: { type: "transform", behavior: "implemented", requires: [] },
    grabbable: {
      type: "grabbable",
      behavior: "implemented",
      requires: ["transform"],
    },
    flippable: { type: "flippable", behavior: "implemented", requires: [] },
    card: { type: "card", behavior: "implemented", requires: ["transform"] },
    container: { type: "container", behavior: "implemented", requires: [] },
    deck: { type: "deck", behavior: "implemented", requires: ["container"] },
    counter: { type: "counter", behavior: "implemented", requires: [] },
    hand: { type: "hand", behavior: "stub", requires: ["container"] },
    die: { type: "die", behavior: "stub", requires: ["transform"] },
    zone: { type: "zone", behavior: "stub", requires: ["transform"] },
    "snap-point": {
      type: "snap-point",
      behavior: "stub",
      requires: ["transform"],
    },
    text: { type: "text", behavior: "stub", requires: [] },
    button: { type: "button", behavior: "stub", requires: [] },
  });
