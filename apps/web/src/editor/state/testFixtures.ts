import type { CanonicalGameState, EntityRecord } from "digipology-kernel";

import { createEmptyEditorDraft, rebuildDraftIntegrity } from "./bundle";
import type { EditorDraft } from "./types";

export function editorTestDraft(id = "test-draft"): EditorDraft {
  const draft = createEmptyEditorDraft(id, "2026-01-01T00:00:00.000Z");
  const state = draft.bundle.initialSnapshot.state as CanonicalGameState;
  const entity: EntityRecord = {
    id: "card_a",
    components: {
      transform: {
        position: { x: 0, y: 0.2, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      card: { definitionId: "ace", faceUp: true },
      grabbable: { enabled: true, heldBy: null },
      flippable: { flipped: false },
    },
  };
  state.entities[entity.id] = entity;
  draft.bundle.definitions = { ace: { label: "Ace", color: "#f4ead6" } };
  rebuildDraftIntegrity(draft);
  return draft;
}
