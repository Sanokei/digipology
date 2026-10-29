import { canonicalStringify } from "digipology-canonical-json";
import type { CanonicalGameState } from "digipology-kernel";
import type { ReleaseBundleDto } from "digipology-protocol/http";

export function authoringFromBundle(bundle: ReleaseBundleDto, omitPresentation = false): Record<string, unknown> {
  const state = bundle.initialSnapshot.state as CanonicalGameState;
  return {
    title: bundle.title ?? "Untitled game",
    tagline: "",
    artDirection: null,
    interactionMode: bundle.interactionMode,
    minPlayers: bundle.minPlayers,
    maxPlayers: bundle.maxPlayers,
    files: bundle.files.filter((file) => !omitPresentation || !file.path.startsWith("runtime/presentation/")).map(({ path, content }) => ({ path, content })),
    settings: Object.keys(state.settings).sort().map((key) => {
      const value = state.settings[key]!;
      return {
        key,
        valueType: typeof value,
        stringValue: typeof value === "string" ? value : "",
        numberValue: typeof value === "number" ? value : 0,
        booleanValue: typeof value === "boolean" ? value : false,
      };
    }),
    entities: Object.keys(state.entities).sort().map((id) => ({
      id,
      components: Object.keys(state.entities[id]!.components).sort().map((type) => ({
        type,
        dataJson: canonicalStringify(state.entities[id]!.components[type]),
      })),
    })),
    scriptStateJson: canonicalStringify(state.scriptState),
    rngSeed: [...state.rng.state],
    definitions: Object.keys(bundle.definitions ?? {}).sort().map((id) => ({
      id,
      label: bundle.definitions?.[id]?.label ?? "",
      color: bundle.definitions?.[id]?.color ?? "",
    })),
    refs: Object.keys(bundle.refs ?? {}).sort().map((name) => ({ name, entityId: bundle.refs![name]! })),
  };
}
