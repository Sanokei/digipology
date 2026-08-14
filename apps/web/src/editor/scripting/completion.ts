import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { LuaApiManifest } from "digipology-lua/lua-api-manifest";

export function manifestCompletionOptions(manifest: LuaApiManifest, prefix = ""): Completion[] {
  const options: Completion[] = manifest.entries
    .filter((entry) => prefix === "" || entry.label.startsWith(prefix))
    .map((entry) => ({
      label: entry.label,
      type: entry.kind === "field" ? "property" : entry.kind === "namespace" ? "variable" : "function",
      detail: entry.signature,
      info: entry.documentation,
    }));
  for (const entry of manifest.entries.filter((candidate) => candidate.kind === "callback" || candidate.kind === "guard")) {
    if (prefix !== "" && !entry.label.startsWith(prefix)) continue;
    const denied = entry.kind === "guard" ? "\n    return true" : "";
    options.push({
      label: entry.label,
      type: "snippet",
      detail: `${entry.kind} skeleton`,
      info: entry.documentation,
      apply: `function ${entry.label}(ctx)${denied}\nend`,
    });
  }
  options.push({
    label: "timer_callback",
    type: "snippet",
    detail: "Named timer callback skeleton",
    info: "Named callbacks survive sandbox reconstruction.",
    apply: "function timer_callback(ctx)\n    \nend",
  });
  return options;
}

export function createLuaCompletionSource(manifest: LuaApiManifest): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z_][\w.:]*/);
    if (word === null && !context.explicit) return null;
    const prefix = word?.text ?? "";
    return {
      from: word?.from ?? context.pos,
      options: manifestCompletionOptions(manifest, prefix),
      validFor: /^[\w.:]*$/,
    };
  };
}

export function createLuaHoverTooltip(manifest: LuaApiManifest) {
  const byLabel = new Map(manifest.entries.map((entry) => [entry.label, entry]));
  return hoverTooltip((view, position) => {
    const line = view.state.doc.lineAt(position);
    const column = position - line.from;
    const start = line.text.slice(0, column).search(/[A-Za-z_][\w.:]*$/);
    if (start < 0) return null;
    const end = column + (line.text.slice(column).match(/^[\w.:]*/)?.[0].length ?? 0);
    const word = line.text.slice(start, end);
    const entry = byLabel.get(word);
    if (entry === undefined) return null;
    return {
      pos: line.from + start,
      end: line.from + end,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "editor-lua-tooltip";
        dom.textContent = `${entry.signature}\n\n${entry.documentation}`;
        return { dom };
      },
    } satisfies Tooltip;
  });
}
