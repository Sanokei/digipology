# ADR-0006: Client-attested checkpoints for scripted rooms

Status: Accepted · Date: 2026-08-15

## Context

The Room Durable Object previously authored every checkpoint by mechanically replaying the built-in kernel registry. That is correct for unscripted releases, but it omits Lua callbacks and their canonical mutations for releases whose initial snapshot contains a `script` component. After the bounded action window advanced past the initial snapshot, a late bootstrapper could therefore receive a checkpoint whose hash differed from live clients.

ARCH-007 forbids moving Lua or ordinary game-rule simulation into the Room DO. SPEC 05.6 instead defines client-generated checkpoints with friendly-mode hash corroboration.

## Decision

1. Keep mechanical checkpoint replay unchanged for unscripted snapshots.
2. Treat a room as scripted exactly when its initial canonical snapshot contains at least one entity with a `script` component. The kernel exports this predicate for both worker and web use; packaged Lua files without a binding do not make a snapshot scripted.
3. Scripted clients submit their confirmed canonical snapshot over `POST /api/rooms/:roomId/checkpoints` whenever the applied sequence is a positive multiple of 200. The request includes the room token, sequence, state hash, and snapshot. Reporting is best-effort and never interrupts the ordered stream.
4. The Room DO authenticates and rate-limits the player, caps the request body at 1 MiB, verifies the snapshot with `loadSnapshot`, and checks release, sequence, hash, cadence, and retained-window connectivity. It compares hashes and stores snapshot bytes; it never runs Lua.
5. With two or more distinct connected players, two distinct connected players must attest the same sequence and hash. Duplicate attestations from one player do not count twice. A conflicting hash permanently marks that sequence divergent and it cannot be confirmed. When exactly one distinct healthy player is connected, that player may self-confirm; this is the explicit friendly-mode interpretation of “where practical” in SPEC 05.6.
6. Until a scripted checkpoint is confirmed, the room retains the complete ordered log and bootstraps from the initial snapshot plus that log. Once confirmed, the checkpoint becomes the base and history older than the ordinary 500-action reconnect window may be removed. New actions remain available from that base until a newer checkpoint is confirmed.
7. Checkpoints created before this distinction are not considered attested for scripted rooms and are never served as scripted bootstrap bases.

## Alternatives considered

- **Run Lua in the DO:** rejected because it violates ARCH-007 and would add release fetching and a Lua VM to the sequencing path.
- **Use client attestations for every room:** rejected because unscripted mechanical replay is already deterministic and avoids an unnecessary client dependency.
- **Only disable scripted checkpoints:** rejected because it would make every long scripted bootstrap permanently depend on an unbounded log.

## Consequences

- Long scripted rooms remain correct without backend game-rule execution.
- Healthy scripted rooms normally regain bounded bootstrap payloads at the 200-action cadence.
- A lone connected player is trusted in friendly mode; this is not Byzantine consensus.
- If no checkpoint can be confirmed, storage and bootstrap cost grow with room lifetime, bounded by the existing room expiry policy and surfaced through structured fallback-size logging.
