import { canonicalStringify } from "digipology-canonical-json";
import type { CanonicalGameState } from "digipology-kernel";
import type { ReleaseBundleDto } from "digipology-protocol/http";

import { scriptFiles } from "./state/scripts";

export interface AiEditSummary {
  readonly entityCountDelta: number;
  readonly scriptLineDeltas: Readonly<Record<string, number>>;
  readonly changedSettingsKeys: readonly string[];
}

function lineCount(content: string | undefined): number {
  if (content === undefined || content === "") return 0;
  return content.split(/\r?\n/).length;
}

export function summarizeAiEdit(before: ReleaseBundleDto, after: ReleaseBundleDto): AiEditSummary {
  const beforeState = before.initialSnapshot.state as CanonicalGameState;
  const afterState = after.initialSnapshot.state as CanonicalGameState;
  const beforeScripts = new Map(scriptFiles(before).map((file) => [file.path, file.content]));
  const afterScripts = new Map(scriptFiles(after).map((file) => [file.path, file.content]));
  const scriptLineDeltas: Record<string, number> = {};
  for (const path of new Set([...beforeScripts.keys(), ...afterScripts.keys()])) {
    const delta = lineCount(afterScripts.get(path)) - lineCount(beforeScripts.get(path));
    if (delta !== 0 || beforeScripts.get(path) !== afterScripts.get(path)) scriptLineDeltas[path] = delta;
  }
  const changedSettingsKeys = [...new Set([
    ...Object.keys(beforeState.settings),
    ...Object.keys(afterState.settings),
  ])].filter((key) => canonicalStringify(beforeState.settings[key] ?? null) !== canonicalStringify(afterState.settings[key] ?? null)).sort();
  return {
    entityCountDelta: Object.keys(afterState.entities).length - Object.keys(beforeState.entities).length,
    scriptLineDeltas,
    changedSettingsKeys,
  };
}
