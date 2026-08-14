export interface EditorCreatePrefill {
  title: string;
  tagline: string;
  slug: string;
  minPlayers: number;
  maxPlayers: number;
  bundleText: string;
}

export interface EditorCreateLocationState {
  editorDraftPrefill: EditorCreatePrefill;
}

export function readEditorCreatePrefill(value: unknown): EditorCreatePrefill | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prefill = (value as Record<string, unknown>).editorDraftPrefill;
  if (typeof prefill !== "object" || prefill === null || Array.isArray(prefill)) return null;
  const item = prefill as Record<string, unknown>;
  if (!["title", "tagline", "slug", "bundleText"].every((key) => typeof item[key] === "string") ||
      !Number.isSafeInteger(item.minPlayers) || !Number.isSafeInteger(item.maxPlayers)) return null;
  return item as unknown as EditorCreatePrefill;
}
