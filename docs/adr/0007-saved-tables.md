# ADR-0007: Saved tables and resumed-room reconstruction

Status: Accepted · Date: 2026-08-16

## Context

SPEC 05.10 and 07.5 require an authenticated administrative Host to persist a canonical table snapshot pinned to its exact Release, then resume it as a new live Room. The Room Durable Object remains the sequencer, never runs Lua, and must authorize save and end operations without trusting client-provided host metadata. Saved snapshots also need StateHash verification and a reconstruction path that does not replay game-start hooks.

## Decision

1. The first successful Room join sets `room.host_player_id`. When that player loses their final socket, the Room selects the oldest still-connected player by `players` row order. If nobody remains connected, it keeps the prior host so that player remains Host if they return. This migration currently lives in the socket-departure path because there is no canonical departure hook; it moves to that hook when one lands.
2. `PlayerInfo.host` exposes the current host in bootstrap player metadata only. Existing clients may ignore the optional field, and live migration is learned on a later bootstrap. It is never authorization: save and end authenticate the opaque room token inside the Room DO and compare the resulting player id to `host_player_id`, as required by SPEC 07.4.
3. Unscripted rooms save a mechanical checkpoint computed by the DO from its trusted base plus ordered actions. Scripted rooms prefer an attested checkpoint only when it is at the current room sequence; otherwise the Host supplies its confirmed client snapshot at that sequence. Every selected snapshot must match the pinned Release and pass `loadSnapshot`, including recomputation of its StateHash. Save is not a checkpoint cadence event, so the 200-action cadence rule from ADR-0006 does not apply.
4. The verified snapshot is stored as-is. Its original sequence and StateHash are recorded in D1 and the identical JSON object is written to R2.
5. Resume validates the stored object again, then creates a new Room whose initial base is `snapshot({ ...loadSnapshot(saved), sequence: 0 })`. This recomputes the sequence-zero StateHash while preserving the saved canonical state.
6. Before the resumed roster joins, the Room sequences `system.player_left` for saved player ids in deterministic order. This removes ghost players, vacates their seats, and releases entities they held. It then sequences the normal player joins and seat assignments. Seat-owned hands remain attached to their seats. Resume does not emit `system.game_start`, because doing so would rerun Lua start hooks and could redeal or otherwise duplicate setup. See item 10 for the script-state limitation this cleanup does not cover.
7. Scheduled canonical timers are re-armed once with `due_at = now + delay`. The full delay restarts on resume; no old Durable Object timer rows exist in the new Room, so a timer cannot fire from both rooms. This preserves the SPEC 05.8 one-shot/no-duplicate guarantee without inventing elapsed wall-clock state in a canonical save.
8. Snapshot objects use `saves/<saveId>.json` in the existing `RELEASES` R2 bucket through `saveBucket`, separate from immutable releases by prefix. D1 `saved_tables` owns listing, account scope, Release pins, integrity metadata, and soft deletion. New room provenance uses nullable `rooms_index.resumed_from_save_id`; `origin` remains `hosted` rather than expanding its existing checked values.
9. No kernel change or transient-stripping helper is needed. PRD-SAVE-004 names camera, cursor, hover, and WebRTC state, none of which is canonical kernel state, so `GameSnapshot` already excludes it. Held state, prompts, and timers are canonical. Removing them at save time would invalidate the StateHash and make `loadSnapshot` fail; player-bound held state is released later by the canonical ghost-player departure actions.
10. Canonical snapshots can also contain script-owned data that the kernel cannot see or remap. `state.scriptState` is opaque, and the Lua standard library stores turn order in `__stdlib.turns.order` as literal player ids. `system.player_left` therefore cannot prune those ids, while resume does not run `on_start`, the only hook that rebuilds `turns.order`. A resumed scripted table consequently names players from the saved room in its turn order: no live player is ever current, and the re-armed turn timer faults inside the script. Item 9's transient-exclusion reasoning covers canonical state only and says nothing about script-owned state. Resume therefore refuses every save for which `snapshotRequiresScripts` is true with `409 scripted_resume_unsupported`. Saving scripted tables remains allowed because the stored snapshot is correct and becomes resumable once roster remapping lands, and the saved-tables list marks those saves non-resumable so the product does not promise a broken path. The fix belongs in the kernel or Lua standard library, through a resume-time roster remap such as `system.game_resumed` or by pruning dead ids from `__stdlib.turns` on `player.left`, and is tracked by issue #94.

## Alternatives considered

- **Run scripted replay in the Room DO:** rejected by ARCH-007 and ADR-0006.
- **Trust `PlayerInfo.host` or a request flag:** rejected because bootstrap metadata is stale-capable and SPEC 07.4 forbids client authorization claims.
- **Mutate snapshots during save:** rejected because persistence must retain the verified canonical object and its exact StateHash.
- **Emit `system.game_start` on resume:** rejected because creator start hooks are not idempotent reconstruction hooks.

## Consequences

- Saves are account-owned, Host-only, integrity-checked, and pinned to an exact Release.
- Resume creates a distinct Room and invite code while retaining canonical board, seat, hand, prompt, and timer state.
- Ghost-player cleanup is visible in the new Room's ordered action stream, and scripted creator logic remains client-side.
- Scripted saves remain safely stored and visibly non-resumable until issue #94 provides kernel or Lua standard-library roster remapping; resume rejects them with `409 scripted_resume_unsupported` before allocating a Room.
