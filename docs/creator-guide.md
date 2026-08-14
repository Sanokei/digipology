---
title: "Creator guide"
description: "Build, script, playtest, and publish a Digipology game from the desktop browser editor."
---

# Digipology creator guide

Digipology's desktop browser editor keeps the table, components, Lua rules, diagnostics, and playtest controls in one docked workspace. It works with release bundles, so a draft can move through the same validation and publishing path as an imported JSON bundle.

## Start and manage a draft

Editor drafts are local to the current browser. Digipology stores the draft index, each draft, and the saved panel layout in `localStorage` under the `dgp.editor.` prefix; there is no account-backed draft sync.

Use the **File** menu to create a new draft, open a local draft by ID, import a release bundle, export the open draft as JSON, or hand the draft off for publishing. The same commands are available from the command palette with **Ctrl+K** (or **Command+K** on macOS). New, open, and export also have the shortcuts shown in the File menu.

Edits autosave to local storage 2.5 seconds after the latest change. The status area reports whether the draft is saving, saved, or could not be saved. Export important work when you want a portable backup.

## Work in the docked editor

The default layout groups eight panels. Tabs can be docked and resized, and closable panels can be reopened from the Window menu:

- **Hierarchy** lists entities as a tree. Select an entity to inspect it; press **F2** or double-click to rename it. Its context menu also provides rename, duplicate, and delete actions.
- **Inspector** shows one card for every component on the selected entity. You can edit supported fields, add components, and remove components when their dependencies allow it. Drag a numeric field's grip to scrub its value.
- **Table** is the viewport. It renders the current draft read-only until a playtest starts, then becomes the interactive playtest table.
- **Scripts** creates, selects, renames, and deletes files under `scripts/`.
- **Lua IDE** edits the selected script with Lua-aware completion and formatting. **Ctrl+S** formats the script with StyLua.
- **AI Assist** can create a new draft or preview an edit when server-side AI is available. See [AI features](./ai-features.md) for availability and limits.
- **Console** combines editor diagnostics with logs from the current playtest.
- **History** lists undo frames and exposes undo and redo controls.

The layout is saved as you rearrange it. Use **Window → Reset layout** to discard the saved arrangement and restore the default workspace.

## Undo, redo, and scrubbing

The editor retains the most recent 100 undo frames. **Ctrl+Z** undoes a change, **Ctrl+Shift+Z** redoes it, and the History panel can jump back to an earlier frame. Making a new edit after undoing clears the redo path.

Dragging an Inspector number scrubber previews each intermediate value but records the completed drag as one undo entry. Inspector text and number fields commit their change when you finish editing them rather than creating a frame for every keystroke.

## Add rules with Lua

Create a `.lua` file in the Scripts panel, select it, and write the rules in the Lua IDE. Scripts run inside Digipology's sandbox against the documented creator API, not against browser or Node.js APIs. The [Lua API v1 reference](./lua-api.md) covers callbacks, entities, players, prompts, timers, deterministic random calls, and the available standard-library surface.

## Playtest in the editor tab

Choose **Play draft** from the Play menu, press **F5**, or use the **Play** button in the status bar. The editor validates and compiles the current draft, starts an isolated in-tab kernel and Lua runtime, and switches the Table panel to that runtime. Interactions and script output appear in the shared viewport and Console.

While playing, **F5** advances one kernel tick so scheduled callbacks can run. Use **Shift+F5** or **Stop** to end the playtest; its runtime state is discarded, leaving the editable draft unchanged.

## Publish through the validated create flow

Choose **Publish** from the File menu or status bar. The editor passes the draft's title, tagline, player range, slug, and bundle JSON to the normal create page. Review the fields and validation report there, then use the regular publish action. Publishing never happens directly from the editor, and a guest is prompted to sign in when they attempt to publish.

For the JSON contract and the checks applied before anything is persisted, see the [release bundle format](./bundle-format.md).

## Desktop browser required

The editor is desktop-only. It loads only in a viewport at least 900 pixels wide with a fine pointer. Mobile, narrow, and coarse-pointer environments receive a desktop-editor message and continue to have access to browsing and play; the editor itself is not loaded there.
