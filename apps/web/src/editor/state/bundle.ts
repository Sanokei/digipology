import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import {
  createInitialState,
  snapshot,
  type CanonicalGameState,
} from "digipology-kernel";
import {
  rawContentHash,
  releaseManifestHash,
  type ReleaseBundleDto,
} from "digipology-protocol/http";

import { prevalidateRelease } from "../../releaseValidation";
import type { EditorDraft } from "./types";
import { createScript, updateScript } from "./scripts";

export type EditorTemplateId = "blank" | "card" | "dice" | "zone";

export const EDITOR_TEMPLATES = Object.freeze([
  { id: "blank" as const, title: "Blank Table", description: "An empty sandbox with one editable game script." },
  { id: "card" as const, title: "Card Game", description: "A deck, player hand, and working deal/draw loop." },
  { id: "dice" as const, title: "Dice Game", description: "A rollable die that adds each result to a score." },
  { id: "zone" as const, title: "Zone Game", description: "A draggable piece, snap slot, and scoring zone." },
]);

const TEMPLATE_IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "_").replaceAll(/^_+|_+$/g, "");
  return (normalized || "draft").slice(0, 96);
}

export function rebuildDraftIntegrity(draft: EditorDraft): void {
  const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
  draft.bundle.title = draft.title;
  draft.bundle.minPlayers = draft.minPlayers;
  draft.bundle.maxPlayers = draft.maxPlayers;
  draft.bundle.initialSnapshot = snapshot(state) as unknown as ReleaseBundleDto["initialSnapshot"];
  draft.bundle.integrity.manifestHash = releaseManifestHash(draft.bundle, hashValue);
}

export function createEmptyEditorDraft(id: string, now = new Date().toISOString()): EditorDraft {
  const suffix = draftIdentifier(id);
  const releaseId = `draft_${suffix}_1`;
  const content = "{}";
  const state = createInitialState({
    releaseId,
    rng: { algorithm: "sfc32-v1", state: [1, 2, 3, 4], draws: 0 },
  });
  const bundle: ReleaseBundleDto = {
    formatVersion: 1,
    gameId: `draft_${suffix}`,
    releaseId,
    releaseNumber: 1,
    kernelVersion: 1,
    luaApiVersion: 1,
    luaStdlibVersion: 1,
    networkProtocolVersion: 1,
    interactionMode: "sandbox",
    minPlayers: 1,
    maxPlayers: 4,
    files: [{
      path: "runtime/game.json",
      content,
      byteLength: new TextEncoder().encode(content).byteLength,
      contentHash: rawContentHash(content, sha256),
    }],
    integrity: { manifestHash: `sha256:${"0".repeat(64)}` },
    initialSnapshot: snapshot(state) as unknown as ReleaseBundleDto["initialSnapshot"],
    title: "Untitled Game",
    definitions: {},
  };
  const draft: EditorDraft = {
    editorVersion: 1,
    id,
    title: "Untitled Game",
    tagline: "",
    slug: "",
    minPlayers: 1,
    maxPlayers: 4,
    createdAt: now,
    updatedAt: now,
    bundle,
  };
  createScript(draft, "game.lua", "");
  bundle.integrity.manifestHash = releaseManifestHash(bundle, hashValue);
  return draft;
}

function prepareTemplate(
  id: string,
  now: string,
  title: string,
  tagline: string,
): { draft: EditorDraft; state: CanonicalGameState } {
  const draft = createEmptyEditorDraft(id, now);
  draft.title = title;
  draft.tagline = tagline;
  draft.slug = "";
  draft.minPlayers = 1;
  draft.maxPlayers = 4;
  draft.bundle.interactionMode = "scripted";
  draft.bundle.title = title;
  const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
  state.seats = {
    "playtest-seat": { id: "playtest-seat", playerId: null },
  };
  return { draft, state };
}

export function createCardGameEditorDraft(
  id: string,
  now = new Date().toISOString(),
): EditorDraft {
  const { draft, state } = prepareTemplate(
    id,
    now,
    "Card Game",
    "Deal a card, then press Draw to keep the hand growing.",
  );
  state.seats["playtest-seat"] = {
    id: "playtest-seat",
    playerId: null,
    handId: "player_hand",
  };
  state.entities = {
    card_rules: {
      id: "card_rules",
      components: {
        script: { scriptId: "scripts/game.lua", bindingId: "card_game_rules", props: { role: "game" } },
      },
    },
    draw_button: {
      id: "draw_button",
      components: {
        button: { enabled: true, label: "Draw" },
        script: { scriptId: "scripts/game.lua", bindingId: "card_draw_button", props: { role: "draw" } },
        transform: { ...TEMPLATE_IDENTITY, position: { x: 2, y: 0, z: 0 } },
      },
    },
    main_deck: {
      id: "main_deck",
      components: {
        container: {
          items: ["card_1", "card_2", "card_3", "card_4"],
          capacity: 12,
          ordering: "stack",
          visibility: "public",
        },
        deck: { enabled: true },
        transform: { ...TEMPLATE_IDENTITY, position: { x: -2, y: 0, z: 0 } },
      },
    },
    player_hand: {
      id: "player_hand",
      components: {
        container: { items: [], capacity: 8, ordering: "canonical", visibility: "owner:playtest-seat" },
        hand: { owner: "playtest-seat", canonicalOrder: true },
      },
    },
  };
  for (let index = 1; index <= 4; index += 1) {
    const cardId = `card_${index}`;
    state.entities[cardId] = {
      id: cardId,
      components: {
        card: { definitionId: `starter_card_${index}`, faceUp: false },
        flippable: { flipped: false },
        grabbable: { enabled: true, heldBy: null },
        transform: { ...TEMPLATE_IDENTITY, position: { x: -2, y: index * 0.25, z: 0 } },
      },
    };
  }
  draft.bundle.refs = { main_deck: "main_deck", player_hand: "player_hand" };
  draft.bundle.definitions = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    `starter_card_${index + 1}`,
    { label: `Starter Card ${index + 1}`, color: index % 2 === 0 ? "#f3a53b" : "#8b5cf6" },
  ]));
  updateScript(draft, "scripts/game.lua", `function on_start(ctx)
  if props.role ~= "game" then return end
  refs.main_deck:shuffle()
  for _, player in ipairs(players:list()) do
    if player.hand then refs.main_deck:draw_to(player.hand, 1) end
  end
end

function on_press(ctx)
  if props.role ~= "draw" or refs.main_deck.count == 0 then return end
  local player = players:list()[1]
  if player and player.hand then refs.main_deck:draw_to(player.hand, 1) end
end

function on_player_join(ctx)
  if props.role == "game" and refs.main_deck.count > 0 then
    refs.main_deck:draw_to(refs.player_hand, 1)
  end
end

return {}
`);
  rebuildDraftIntegrity(draft);
  return draft;
}

export function createDiceGameEditorDraft(
  id: string,
  now = new Date().toISOString(),
): EditorDraft {
  const { draft, state } = prepareTemplate(
    id,
    now,
    "Dice Game",
    "Roll the die and watch its canonical result add to the score.",
  );
  state.entities = {
    die: {
      id: "die",
      components: {
        die: { definitionId: "starter_d6", value: 1, faces: [1, 2, 3, 4, 5, 6] },
        grabbable: { enabled: true, heldBy: null },
        script: { scriptId: "scripts/game.lua", bindingId: "dice_game_die", props: {} },
        transform: TEMPLATE_IDENTITY,
      },
    },
    score: {
      id: "score",
      components: {
        counter: { value: 0, default: 0, min: 0, max: 99 },
        transform: { ...TEMPLATE_IDENTITY, position: { x: 2, y: 0, z: 0 } },
      },
    },
  };
  draft.bundle.refs = { score: "score" };
  draft.bundle.definitions = { starter_d6: { label: "Starter D6", color: "#22c55e" } };
  updateScript(draft, "scripts/game.lua", `function on_roll(ctx)
  refs.score:add(self.value)
end

return {}
`);
  rebuildDraftIntegrity(draft);
  return draft;
}

export function createZoneGameEditorDraft(
  id: string,
  now = new Date().toISOString(),
): EditorDraft {
  const { draft, state } = prepareTemplate(
    id,
    now,
    "Zone Game",
    "Drop the runner onto the board slot to score.",
  );
  state.entities = {
    runner: {
      id: "runner",
      components: {
        grabbable: { enabled: true, heldBy: null },
        tags: { values: ["runner"] },
        transform: { ...TEMPLATE_IDENTITY, position: { x: 0, y: 0, z: 3 } },
      },
    },
    scoring_zone: {
      id: "scoring_zone",
      components: {
        zone: { shape: "box", acceptedTags: ["runner"], visibleInPlay: true, members: [] },
        script: { scriptId: "scripts/game.lua", bindingId: "zone_game_scoring", props: {} },
        transform: { ...TEMPLATE_IDENTITY, scale: { x: 4, y: 2, z: 4 } },
      },
    },
    board_slot: {
      id: "board_slot",
      components: {
        "snap-point": { radius: 1, capacity: 1, tags: ["runner"], alignment: null, attached: [] },
        transform: TEMPLATE_IDENTITY,
      },
    },
    score: {
      id: "score",
      components: {
        counter: { value: 0, default: 0, min: 0, max: 10 },
        transform: { ...TEMPLATE_IDENTITY, position: { x: 3, y: 0, z: 0 } },
      },
    },
  };
  draft.bundle.refs = { score: "score" };
  draft.bundle.definitions = { runner: { label: "Runner", color: "#38bdf8" } };
  updateScript(draft, "scripts/game.lua", `function on_enter(ctx)
  refs.score:add(1)
end

return {}
`);
  rebuildDraftIntegrity(draft);
  return draft;
}

export function createEditorDraftFromTemplate(
  templateId: EditorTemplateId,
  id: string,
  now = new Date().toISOString(),
): EditorDraft {
  if (templateId === "card") return createCardGameEditorDraft(id, now);
  if (templateId === "dice") return createDiceGameEditorDraft(id, now);
  if (templateId === "zone") return createZoneGameEditorDraft(id, now);
  return createEmptyEditorDraft(id, now);
}

export function normalizeReleaseBundle(value: unknown): ReleaseBundleDto {
  const text = canonicalStringify(value);
  if (!isRecord(value)) throw new TypeError("The bundle must be a JSON object.");
  const minPlayers = value.minPlayers;
  const maxPlayers = value.maxPlayers;
  if (!Number.isSafeInteger(minPlayers) || !Number.isSafeInteger(maxPlayers)) {
    throw new TypeError("The bundle player limits are missing or invalid.");
  }
  const checked = prevalidateRelease(text, minPlayers as number, maxPlayers as number);
  if (checked.bundle === null) {
    const failed = checked.report.find((item) => !item.ok);
    throw new TypeError(failed?.detail ?? `The bundle failed ${failed?.check.replaceAll("_", " ") ?? "validation"}.`);
  }
  return checked.bundle;
}

export function normalizeEditorDraft(value: unknown): EditorDraft {
  if (!isRecord(value) || value.editorVersion !== 1) {
    throw new TypeError("This is not a supported editor draft.");
  }
  const requiredStrings = ["id", "title", "tagline", "slug", "createdAt", "updatedAt"] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string") throw new TypeError(`Draft ${field} is invalid.`);
  }
  if ((value.id as string).trim() === "" || (value.title as string).trim() === "") {
    throw new TypeError("Draft id and title cannot be empty.");
  }
  if (!Number.isSafeInteger(value.minPlayers) || !Number.isSafeInteger(value.maxPlayers)) {
    throw new TypeError("Draft player limits are invalid.");
  }
  const bundle = normalizeReleaseBundle(value.bundle);
  if (value.minPlayers !== bundle.minPlayers || value.maxPlayers !== bundle.maxPlayers) {
    throw new TypeError("Draft and bundle player limits do not match.");
  }
  const strings = value as Record<(typeof requiredStrings)[number], string> & Record<string, unknown>;
  return structuredClone({
    editorVersion: 1,
    id: strings.id,
    title: strings.title,
    tagline: strings.tagline,
    slug: strings.slug,
    minPlayers: value.minPlayers,
    maxPlayers: value.maxPlayers,
    createdAt: strings.createdAt,
    updatedAt: strings.updatedAt,
    bundle,
  } satisfies EditorDraft);
}

export function importBundleAsDraft(
  text: string,
  id: string,
  now = new Date().toISOString(),
): EditorDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("That file is not valid JSON.");
  }
  const bundle = normalizeReleaseBundle(parsed);
  return {
    editorVersion: 1,
    id,
    title: bundle.title ?? "Imported Game",
    tagline: "",
    slug: "",
    minPlayers: bundle.minPlayers,
    maxPlayers: bundle.maxPlayers,
    createdAt: now,
    updatedAt: now,
    bundle: structuredClone(bundle),
  };
}

export function exportBundleText(draft: EditorDraft): string {
  return canonicalStringify(draft.bundle);
}
