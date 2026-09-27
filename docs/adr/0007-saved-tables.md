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
6. The Room sequences exactly one first action, `system.game_resumed`, with the live roster and each seat occupant's prior saved player ID. The kernel atomically replaces the saved roster, releases entities held by removed players, reassigns seats, and remaps player-owned canonical state. Resume does not emit `system.game_start`, because doing so would rerun Lua start hooks and could redeal or otherwise duplicate setup.
7. Scheduled canonical timers are re-armed once with `due_at = now + delay`. The full delay restarts on resume; no old Durable Object timer rows exist in the new Room, so a timer cannot fire from both rooms. This preserves the SPEC 05.8 one-shot/no-duplicate guarantee without inventing elapsed wall-clock state in a canonical save.
8. Snapshot objects use `saves/<saveId>.json` in the existing `RELEASES` R2 bucket through `saveBucket`, separate from immutable releases by prefix. D1 `saved_tables` owns listing, account scope, Release pins, integrity metadata, and soft deletion. New room provenance uses nullable `rooms_index.resumed_from_save_id`; `origin` remains `hosted` rather than expanding its existing checked values.
9. PRD-SAVE-004 names camera, cursor, hover, and WebRTC state, none of which is canonical kernel state, so `GameSnapshot` already excludes it. Held state, prompts, and timers are canonical and remain in the verified snapshot. `system.game_resumed` performs the required identity transition after the snapshot is rebased rather than mutating stored save data or invalidating its StateHash.
10. Canonical snapshots can also contain script-owned data that the kernel treats as opaque. Before dispatching `on_game_resumed`, Lua standard library v1 uses the action's saved-to-live roster mapping to reconcile `__stdlib.turns` and player-keyed `__stdlib.scores`; it preserves the current turn when possible, prunes removed players, and retains non-player score keys. This reconciliation is deterministic and idempotent. Creator-owned state remains under creator control and can respond to `on_game_resumed(ctx)` when it stores player IDs outside the standard library. Scripted saves use the same resume path as unscripted saves.

## Alternatives considered

- **Run scripted replay in the Room DO:** rejected by ARCH-007 and ADR-0006.
- **Trust `PlayerInfo.host` or a request flag:** rejected because bootstrap metadata is stale-capable and SPEC 07.4 forbids client authorization claims.
- **Mutate snapshots during save:** rejected because persistence must retain the verified canonical object and its exact StateHash.
- **Emit `system.game_start` on resume:** rejected because creator start hooks are not idempotent reconstruction hooks.

## Consequences

- Saves are account-owned, Host-only, integrity-checked, and pinned to an exact Release.
- Resume creates a distinct Room and invite code while retaining canonical board, seat, hand, prompt, and timer state.
- The complete identity transition is visible as one atomic first action in the new Room's ordered stream, and scripted creator logic remains client-side.
- Scripted saves are resumable: standard-library turn and score state is reconciled before the optional creator resume hook runs.


## Issue #94 amendment: opaque script state and verification (2026-09-27)

A saved roster is also embedded in opaque `scriptState`: standard-library turns
store literal player IDs, and scores may be keyed by player ID. Cleaning only
`players` and seats cannot repair those references. The earlier “no kernel
change needed” reasoning applies to excluding transient presentation state,
not to the identity transition. Items 6, 9, and 10 therefore require the
canonical `system.game_resumed` action and client-side Lua reconciliation.
The kernel continues to treat script state as opaque; the Worker never runs Lua.

The issue sketch simultaneously requested validation at sequence zero and
sequencing resume after departures and joins. We choose one atomic first action:
the input snapshot is sequence 0, unchanged apart from rebasing and rehashing;
`system.game_resumed` is sequence 1. No preceding departure/join actions or
`system.game_start` are emitted. This preserves the bootstrap hash and lets
creator hooks see the entire live roster together. A failed creator hook follows
normal rejection semantics: gameplay rolls back, sequence 1 is consumed, and the
failure is surfaced; setup is not silently rerun.

Saved seats are mapped to the Room's live players in durable join order. Seat
IDs use code-unit ordering, matching `players:list()`; additional players receive
unused generated seat IDs, including when saved seat names are sparse. Unmapped
saved players are removed. The event's `removedPlayerIds` names every prior
identity, including mapped identities; creators use `roster.previousPlayerId`
to distinguish replacement from removal.

The stdlib preserves the mapped current turn if present, otherwise selects the
first surviving turn. It appends new live players in `players:list()` order and
preserves stopped turns. Saved-player scores follow the mapping; unmapped saved
scores are removed. Arbitrary non-player keys (for example team scores) are
preserved: v1 scores accept both player proxies and arbitrary strings, so
unknown string keys cannot safely be classified as departed players. Creator
state outside `__stdlib` remains the creator's responsibility via the new hook.
Reconciliation is restricted to resume deliveries and runs even without a hook;
the existing live-roster marker prevents repeating it for multiple bindings.
Fresh Room player IDs make a subsequent save/resume a new transition.

This extends v1 only for the new resume event. Live `player_left` semantics are
unchanged; continuous departure pruning (option b) needs a separately versioned
stdlib decision. No builtin Lua source, immutable release bundle, or prior
fixture is changed. `zone-runner-resume-v2.json` adds sequence-by-sequence hashes
for independent replay clients, including the rebased base, a full turn cycle,
three timer re-arms, and a winning move. CI rejects modifications, deletions,
or renames of existing demo fixtures relative to the PR base (or prior main
commit), while allowing new files.
