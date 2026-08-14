import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import type { LuaApiManifest } from "digipology-lua/lua-api-manifest";

import { createLuaCompletionSource, createLuaHoverTooltip } from "./completion";
import { formatLua } from "./formatter";

export function createLuaEditorExtensions(options: {
  manifest: LuaApiManifest;
  onChange: (source: string) => void;
  onFormatError: (message: string) => void;
}): Extension[] {
  const saveKeymap = keymap.of([{
    key: "Mod-s",
    preventDefault: true,
    run(view) {
      const before = view.state.doc.toString();
      void formatLua(before).then((result) => {
        if (!result.ok) {
          options.onFormatError(result.error);
          return;
        }
        if (result.value !== before) {
          view.dispatch({ changes: { from: 0, to: before.length, insert: result.value } });
        }
      });
      return true;
    },
  }, indentWithTab]);
  return [
    StreamLanguage.define(lua),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    drawSelection(),
    history(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    search({ top: true }),
    highlightSelectionMatches(),
    EditorState.tabSize.of(4),
    indentUnit.of("    "),
    autocompletion({ override: [createLuaCompletionSource(options.manifest)] }),
    createLuaHoverTooltip(options.manifest),
    saveKeymap,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
    }),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": { height: "100%", background: "#10141a", color: "#edf0f5", fontSize: "13px" },
      ".cm-scroller": { overflow: "auto", fontFamily: "'DM Mono', Consolas, monospace" },
      ".cm-gutters": { background: "#11161d", color: "#657080", borderRight: "1px solid #2b3340" },
      ".cm-activeLine": { background: "#1b202a" },
    }),
  ];
}
