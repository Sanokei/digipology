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

### Choose a starting template

Open **File → New draft**, choose **New draft** in the command palette, press **Ctrl+N**, or visit `/edit` without a draft ID. The **New draft** picker says "Choose a playable starting table. Everything stays editable." and offers:

- **Blank Table** — An empty sandbox with one editable game script.
- **Card Game** — A deck, player hand, and working deal/draw loop.
- **Dice Game** — A rollable die that adds each result to a score.
- **Zone Game** — A draggable piece, snap slot, and scoring zone.

Use any arrow key to move through the choices, **Home** or **End** to jump to an endpoint, **Enter** or **Space** to create the selected template, and **Escape** to close the picker. Closing the picker on the `/edit` landing route returns to the home page.

Every template is an editable starting table that can be played immediately. After you choose one, it is an ordinary autosaved local draft, with the same history, export, and publish paths documented in this guide.

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

Create a `.lua` file in the Scripts panel, select it, and write the rules in the Lua IDE. Attach it through an entity's `script` component so the playtest runtime can discover its stable binding and props. Scripts run inside Digipology's sandbox against the documented creator API, not against browser or Node.js APIs.

Lua standard library v1 includes [`turns`](./lua-api.md#turns) for deterministic player rotation and [`scores`](./lua-api.md#scores) for canonical scoring and stable tie-breaking. The [Lua API v1 reference](./lua-api.md) also covers [callbacks and read-only guards](./lua-api.md#7-callbacks-and-guards), [prompts and named timers](./lua-api.md#6-timers-and-prompts), semantic proxies, and deterministic random calls. Releases pin the stdlib separately with [`luaStdlibVersion`](./bundle-format.md).

## Playtest in the editor tab

Choose **Play draft** from the Play menu, press **F5**, or use the **Play** button in the status bar. The editor validates and compiles the current draft, starts an isolated in-tab kernel and Lua runtime, and switches the Table panel to that runtime. Interactions and script output appear in the shared viewport and Console.

Templates boot in this same in-tab kernel and Lua runtime; the executable-template tests exercise their deal/draw, roll/score, and drop/snap/score interactions.

While playing, **F5** advances one kernel tick so scheduled callbacks can run. Use **Shift+F5** or **Stop** to end the playtest; its runtime state is discarded, leaving the editable draft unchanged.

## How Zone Runner is built

Zone Runner is the canonical end-to-end creator API example. The latest shipped release is `builtin_zone_runner_2`; it keeps v1's Lua behavior and raises the configured turn limit from 2 seconds to 20 seconds. Its read-only [`settings`](./lua-api.md#read-only-settings) are `targetScore = 2` and `turnSeconds = 20`.

### Compose the table

The initial table is ordinary authored data:

- A rules entity binds `scripts/game.lua` with [`props.role = "game"`](./lua-api.md#props).
- The scoring zone accepts the `runner` tag and binds the same script with [`props.role = "scoring_zone"`](./lua-api.md#props).
- A text entity starts as "Waiting for runners" and is exposed to Lua as the stable [`refs.status`](./lua-api.md#stable-refs) reference.
- Four snap points each accept the `runner` tag and have capacity 1.
- Each of four seat hands contains two grabbable pieces tagged `runner`.
- Each seat has a counter bounded from 0 to `targetScore`.

The picker's [Zone Game](#choose-a-starting-template) is the trimmed starting point: one draggable runner, one snap slot, one scoring zone, and one counter.

### Follow the Lua in execution order

1. The game binding's [`on_start`](./lua-api.md#7-callbacks-and-guards) clears the winner and timeout count, starts rotation with [`turns:start()`](./lua-api.md#turns), and initializes every player with [`scores:set(player, 0)`](./lua-api.md#scores). It names the current player in [`refs.status`](./lua-api.md#stable-refs).

2. Startup creates the structured `opening_move` choice with [`ui:prompt`](./lua-api.md#6-timers-and-prompts): the shipped choices are only `"run"` and `"wait"`. It then schedules the named callback with `timer:after(settings.turnSeconds, "turn_timeout")`; in v2 that delay is 20 seconds.

3. After a valid response, [`on_prompt`](./lua-api.md#7-callbacks-and-guards) accepts only the game binding's `opening_move`, stores the response as canonical [`state.opening_choice`](./lua-api.md#2-persistent-state), and changes the status text to show the player's choice.

4. The named [`turn_timeout`](./lua-api.md#6-timers-and-prompts) callback increments `state.timeouts`, advances with [`turns:next()`](./lua-api.md#turns), updates the status, and arms the next turn timer.

5. The zone binding's [`on_enter`](./lua-api.md#7-callbacks-and-guards) ignores a finished game, an entry without a player actor, and any player who fails [`turns:is_current`](./lua-api.md#turns). A valid entry calls [`scores:add(ctx.player, 1)`](./lua-api.md#scores), mirrors the result to the seat's [counter proxy](./lua-api.md#counter) through [`scene:get("score_" .. ctx.player.seat.id):set(value)`](./lua-api.md#scenegetid), and cancels the current timer through [`timer:cancel`](./lua-api.md#6-timers-and-prompts).

6. At `settings.targetScore`, the same callback takes [`scores:leader()`](./lua-api.md#scores), saves the winner ID, calls [`turns:stop()`](./lua-api.md#turns), and writes the win message. Otherwise it advances the turn, updates the status, and schedules the next limit.

7. The separate [`on_player_join`](./lua-api.md#7-callbacks-and-guards) path gives a late guest a score of zero and, while a game is active, rebuilds the rotation around the current player with `turns:start(current)`.

The frozen [v2 golden replay](https://github.com/Sanokei/digipology/blob/main/packages/demo-games/fixtures/zone-runner-replay-v2.json) proves the prompt, zone entry, score, timer, and win sequence deterministically. The [Zone Runner smoke](https://github.com/Sanokei/digipology/blob/main/scripts/smoke-zone-runner.ts) exercises `builtin_zone_runner_2` through guest quick play with two converged clients, then verifies a late client catches up.

## Publish through the validated create flow

Choose **Publish** from the File menu or status bar. The editor passes the draft's title, tagline, player range, slug, and bundle JSON to the normal create page. Review the fields and validation report there, then use the regular publish action. Publishing never happens directly from the editor, and a guest is prompted to sign in when they attempt to publish.

For the JSON contract and the checks applied before anything is persisted, see the [release bundle format](./bundle-format.md).

## Desktop browser required

The editor is desktop-only. It loads only in a viewport at least 900 pixels wide with a fine pointer. Mobile, narrow, and coarse-pointer environments receive a desktop-editor message and continue to have access to browsing and play; the editor itself is not loaded there.
