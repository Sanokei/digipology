import type { EntityComponents, JsonValue, LibraryComponent, TransformComponent } from "./types";

export const OBJECT_LIBRARY_VERSION = 1 as const;

export type ObjectLibraryCategory = "Cards" | "Dice" | "Chips" | "Pieces" | "Tools";

export interface ObjectLibraryItem {
  readonly id: string;
  readonly version: typeof OBJECT_LIBRARY_VERSION;
  readonly category: ObjectLibraryCategory;
  readonly label: string;
  readonly kind: "deck" | "card" | "die" | "chip" | "piece" | "counter" | "bag" | "notecard";
  readonly color: string;
  readonly shape: string;
  readonly sides?: number;
  readonly value?: number;
  readonly seat?: string;
}

const SEAT_COLORS = [
  ["red", "#d84b4b"], ["orange", "#df843c"], ["yellow", "#dfc84a"],
  ["green", "#4daa69"], ["teal", "#3ca6a0"], ["blue", "#477dcc"],
  ["purple", "#8457bd"], ["pink", "#cf6a9e"], ["white", "#e8e5dc"],
  ["black", "#303532"],
] as const;

const fixedItems: ObjectLibraryItem[] = [
  { id: "cards_standard_54", version: 1, category: "Cards", label: "52-card deck + jokers", kind: "deck", color: "#8d3429", shape: "card" },
  { id: "card_blank_white", version: 1, category: "Cards", label: "Blank card", kind: "card", color: "#f5f1e7", shape: "card" },
  ...[4, 6, 8, 10, 12, 20].map((sides): ObjectLibraryItem => ({
    id: `die_d${sides}`, version: 1, category: "Dice", label: `d${sides}`, kind: "die",
    color: "#ece7d8", shape: sides === 6 ? "cube" : "token", sides,
  })),
  ...[1, 5, 25, 100].map((value): ObjectLibraryItem => ({
    id: `chip_${value}`, version: 1, category: "Chips", label: `${value} chip`, kind: "chip",
    color: value === 1 ? "#ece7d8" : value === 5 ? "#bd4b43" : value === 25 ? "#3b9660" : "#292d2b",
    shape: "disc", value,
  })),
  { id: "tool_counter", version: 1, category: "Tools", label: "Counter", kind: "counter", color: "#d7b26d", shape: "cylinder" },
  { id: "tool_bag", version: 1, category: "Tools", label: "Bag", kind: "bag", color: "#704a31", shape: "box" },
  { id: "tool_notecard", version: 1, category: "Tools", label: "Notecard", kind: "notecard", color: "#f0e1a6", shape: "card" },
];

for (const [seat, color] of SEAT_COLORS) {
  for (const shape of ["pawn", "meeple", "cube", "disc"] as const) {
    fixedItems.push({
      id: `${shape}_${seat}`, version: 1, category: "Pieces",
      label: `${seat[0]!.toUpperCase()}${seat.slice(1)} ${shape}`,
      kind: "piece", color, shape, seat,
    });
  }
}

export const OBJECT_LIBRARY: readonly ObjectLibraryItem[] = Object.freeze(
  fixedItems.map((item) => Object.freeze(item)),
);

export function objectLibraryItem(id: string): ObjectLibraryItem | undefined {
  return OBJECT_LIBRARY.find((item) => item.id === id);
}

export const STANDARD_CARD_IDS: readonly string[] = Object.freeze([
  ...["clubs", "diamonds", "hearts", "spades"].flatMap((suit) =>
    ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].map((rank) => `${rank}_${suit}`),
  ),
  "joker_red",
  "joker_black",
]);

export function libraryTransform(transform?: TransformComponent): TransformComponent {
  return transform ?? {
    position: { x: 0, y: 0.08, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function libraryMetadata(item: ObjectLibraryItem): LibraryComponent {
  return {
    version: item.version,
    itemId: item.id,
    label: item.label,
    color: item.color,
    shape: item.shape,
    ...(item.seat === undefined ? {} : { seat: item.seat }),
  };
}

export function simpleLibraryComponents(
  item: ObjectLibraryItem,
  transform: TransformComponent,
  props: Readonly<Record<string, JsonValue>> = {},
): EntityComponents {
  const shared: EntityComponents = {
    transform,
    grabbable: { enabled: true, heldBy: null },
    lockable: { locked: false },
    library: libraryMetadata(item),
  };
  if (item.kind === "card") return {
    ...shared, card: { definitionId: item.id, faceUp: true }, flippable: { flipped: true },
    stackable: { enabled: true },
  };
  if (item.kind === "die") {
    const sides = item.sides ?? 6;
    return { ...shared, die: { definitionId: item.id, value: 1, faces: Array.from({ length: sides }, (_, index) => index + 1) } };
  }
  if (item.kind === "counter") {
    const initial = typeof props.value === "number" && Number.isSafeInteger(props.value) ? props.value : 0;
    return { ...shared, counter: { value: initial, default: initial, min: null, max: null } };
  }
  if (item.kind === "bag") return {
    ...shared, container: { items: [], capacity: null, ordering: "top", visibility: "public" },
  };
  if (item.kind === "notecard") {
    return { ...shared, text: { value: typeof props.text === "string" ? props.text : "Notecard" } };
  }
  if (item.kind === "chip") return {
    ...shared, stackable: { enabled: true }, counter: { value: item.value ?? 1, default: item.value ?? 1, min: null, max: null },
  };
  return { ...shared, stackable: { enabled: true } };
}
