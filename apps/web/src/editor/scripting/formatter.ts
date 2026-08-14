import initStyLua, { format } from "stylua-wasm";

export type LuaFormatResult =
  | { ok: true; value: string }
  | { ok: false; value: string; error: string };

let initialization: Promise<unknown> | null = null;

export async function formatLua(text: string): Promise<LuaFormatResult> {
  try {
    initialization ??= initStyLua();
    await initialization;
    return { ok: true, value: format(text, {}) };
  } catch (error) {
    return { ok: false, value: text, error: error instanceof Error ? error.message : String(error) };
  }
}
