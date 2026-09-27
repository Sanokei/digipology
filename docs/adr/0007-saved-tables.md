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
7. Scheduled canonical timers are re-armed once with `due_at = now + delay`. The full delay restarts on resume; no old Durable Object timer rows exist in the new Room, so rearming does not duplicate a timer lifecycle within the new Room. The original Room can independently fire its own timer. This preserves the SPEC 05.8 one-shot/no-duplicate guarantee without inventing elapsed wall-clock state in a canonical save.
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

## Issue #87 audit follow-up (2026-09-27)

F1: schema access backfills a null administrative host from the oldest durable
player row, including rooms already given a nullable host column by the first
migration. An empty room still assigns its first joiner. Reconnects and full
rooms therefore regain a host without admitting a new participant. A non-null
host is never replaced by this repair.

F3: `players.seat_id` persists the service's allocation. A resumed join selects
the first unassigned saved seat in code-unit order, then the smallest unused
`seat_N`, reserving all saved IDs. Later joins use prior persisted assignments;
bootstrap metadata reports the same seats. Older service rows are backfilled
from the immutable initial snapshot and durable join order. This avoids running
Lua or inferring seats from the live canonical simulation. It does not repair
canonical overwrites already sequenced by the previous implementation.

### F2: canonical pending seats and claims (2026-09-27)

New partial resume actions opt into `preservePendingSeats: true`. Without the
flag, historical `system.game_resumed` frames retain their original behavior
and hashes. Full-roster resumes without escrow still emit the original payload.
This is an additive action/state extension, not a reinterpretation of old logs;
no frozen fixture or release bundle changes. New escrow-aware streams require
clients with this kernel/Lua extension, just as any new canonical action does.

An absent **seated** saved identity is retained in optional canonical
`pendingSeats[seatId]`: its player record, prompts, and references to player-owned
hands/container visibility. The identity leaves `players`, its seat becomes
vacant, and its prompts leave the live prompt collection. Pending ownership is
represented by the seat ID and restored to the claiming player atomically.
Shape, identity uniqueness, prompt ownership and entity references are validated;
the entire escrow is included in the ordinary snapshot/hash. Snapshot load,
checkpoint and replay need no separate persistence channel. Unseated saved
identities retain the historical removal policy because no deterministic seat
exists to claim them.

Lua stores pending scores and the saved turn order/current seat/active flag under
`__stdlib.pending_resume`, using seat IDs. Visible `turns.order` and `scores`
contain only live player IDs (plus existing non-player score keys). Standard
library reconciliation is idempotent across bindings, even without a creator
hook. A repeated save/resume remaps current live identities and preserves still
pending seats. A subsequent resume may also claim all remaining seats in its
first action. Creator-owned IDs outside the stdlib still require creator hooks.

For later arrivals the Room sequences one system-only `system.seat_claim` with
`seatId`, `previousPlayerId`, new `playerId`, and optional name. The kernel checks
that the saved identity matches the pending seat and that the new identity is
unused. It restores the player (including saved metadata), seat, prompts and
ownership, then delivers a reserved `on_seat_claimed(ctx)` runtime event with
the old/new identity and player record. Only the trusted stdlib processes this
event, restoring scores and turns. Creator-defined functions with that name are
not invoked: the DO cannot observe a creator callback rejection after assigning
the seat and restarting timers. Ordinary `on_player_join` is not called for a
recovered identity, avoiding saved score initialization. Invalid, duplicate,
player-origin and script-origin claims reject atomically and consume a sequence.
Runtime failure still rolls back escrow, player, prompts, script state, queued
commands and RNG. The DO never runs Lua.

Gameplay remains paused while **any** saved seat is pending. Player actions,
canonical timer delivery and canonical departures reject without gameplay
mutation; system resume/claim and ordinary join/seat metadata actions remain
available. Visible turns are inactive during this pause; the saved active flag,
order and current seat are restored when the final claim completes. Previously
stopped turns remain stopped. Fresh players joining vacant non-reserved seats
are appended after the saved turn order.

`room.resume_pending_since` is service metadata, persisted at partial startup.
The DO withholds timer delivery and timer alarm deadlines while it is set. Timer
registration during the pause stores its relative remaining delay against the
pause origin. Final roster claim shifts scheduled deadlines by the elapsed
pause and resumes alarms; canceled timers stay canceled. Reload/hibernation
therefore cannot consume a paused timer. Kernel rejection remains a second
boundary against premature timer delivery. Already-started legacy rooms have
no pause marker and keep ordinary late-join sequencing; their previously lost
data cannot be reconstructed by migration. The original save can be resumed
into a new escrow-aware room.

### Disconnects, abandonment, and host recovery

There is deliberately no automatic abandonment timeout: a timer cannot decide
to discard saved gameplay or change the saved current turn. An absent saved
guest who never returns leaves the room paused indefinitely (subject to normal
live-room expiration). The authenticated host can save the paused canonical state
and resume it later, or invite a replacement through the ordinary join code.
Join order claims the next reserved seat; this is seat recovery, not an account
identity check, and any invited replacement may take that seat. The host may
also fill it from another session. No new host-discard/skip-seat action is needed
for these recovery paths, and none is introduced. A future explicit abandon-seat
feature would need its own canonical policy for score, prompts and turns.

Socket departure is transport-only, including during the pause. It neither
drops escrow nor vacates already claimed canonical seats. A claimant who joins
by HTTP and then never opens a socket has already claimed the seat; their bearer
session can reconnect. A further invite cannot steal that assigned seat. If the
claimant loses that session, this patch does not add takeover of a live occupied
seat; saving and resuming into a fresh room provides fresh seat allocation.
Host migration on socket departure remains administrative metadata.

A creator callback that rejects resume/claim is surfaced as a canonical failure,
with saved data retained by rollback. There is no automatic in-room claim retry
RPC; saving the retained state and resuming a fresh room can retry, but a
permanently failing pinned creator hook still needs creator-level correction.

Timer clarification for item 7: each independent room may fire its own timer.
Rearming deduplicates within the new room's timer lifecycle; it does not stop the
original room's timer or prevent it firing there.
