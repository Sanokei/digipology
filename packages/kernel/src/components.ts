import type { ComponentDefinition } from "./types";

export const componentRegistry: Readonly<Record<string, ComponentDefinition>> =
  Object.freeze({
    transform: { type: "transform", behavior: "implemented", requires: [] },
    grabbable: {
      type: "grabbable",
      behavior: "implemented",
      requires: ["transform"],
    },
    lockable: { type: "lockable", behavior: "implemented", requires: [] },
    flippable: { type: "flippable", behavior: "implemented", requires: [] },
    stackable: { type: "stackable", behavior: "implemented", requires: [] },
    tags: { type: "tags", behavior: "implemented", requires: [] },
    card: { type: "card", behavior: "implemented", requires: ["transform"] },
    container: { type: "container", behavior: "implemented", requires: [] },
    deck: { type: "deck", behavior: "implemented", requires: ["container"] },
    counter: { type: "counter", behavior: "implemented", requires: [] },
    hand: { type: "hand", behavior: "implemented", requires: ["container"] },
    die: { type: "die", behavior: "implemented", requires: ["transform"] },
    zone: { type: "zone", behavior: "implemented", requires: ["transform"] },
    "snap-point": {
      type: "snap-point",
      behavior: "implemented",
      requires: ["transform"],
    },
    text: { type: "text", behavior: "implemented", requires: [] },
    button: { type: "button", behavior: "implemented", requires: [] },
    script: { type: "script", behavior: "implemented", requires: [] },
  });
