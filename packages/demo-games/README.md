# digipology-demo-games

Immutable, zero-runtime-dependency release bundles for the games that make a
fresh Digipology deployment playable before uploaded releases exist. The
catalog is pure TypeScript data: the runtime files and Lua sources are inlined,
and the worker can import them without filesystem or R2 access.

```ts
import { BUILTIN_GAMES, getBuiltinRelease } from "digipology-demo-games";

const release = getBuiltinRelease("builtin_first_deal_1");
```

Each game exposes immutable `releases` and a `latestReleaseId`; editing released
content requires a new release and golden fixture rather than updating an
existing hash. The three legacy games retain their original hand-authored
release bytes. New games use the data-driven authoring pipeline below.

## How to add a builtin game

1. Create `src/games/<slug>/build.ts`. Export a builder that returns a complete
   `BuiltinReleaseSource`: version pins, player range, interaction mode, runtime
   and Lua files, opaque presentation `definitions`, stable `refs`, and a
   sequence-zero kernel state. Author every seat and canonical table component
   needed by the game in that state. `src/authoring/` provides square and hex
   grids, ring layouts, and standard 52-card deck generation.
2. Add `src/games/<slug>/index.ts` with browse metadata and a `CoverSpec` from
   `digipology-covers`. Import the generated release from the same folder.
3. Run `bun run build:builtins` from the repository root. The command discovers
   every `games/*/build.ts` and uses the real canonical JSON and
   kernel implementations to compute file hashes, manifest hash, and snapshot
   state hash. It writes `release-<n>.generated.ts` only when that release does
   not exist. If committed bytes differ, it fails: restore the builder or bump
   the release number.
4. Add the game import to `src/catalog.ts`. Generated builtins are served by the
   worker through their authored `initialSnapshot`, using the same room-start
   path as uploaded releases.
5. Add a kernel load/replay test with a pinned final state hash. Run
   `bun run build:builtins`, `bun run typecheck`, and `bun test` before commit.

Never edit or replace an existing generated release. Any released change,
including a runtime file or initial state change, is a new release number.

## First Deal

First Deal is a 2–4 player sandbox card table with a standard 52-card deck and
one container-backed hand per seat. Its `on_start` Lua callback returns a
`deck.shuffle` followed by one `deck.draw_to_container` action for every
occupied seat, dealing five cards each. Players can continue to draw and
shuffle, and can flip, grab, and drop individual cards.

Registered kernel actions used:

- `system.game_start`
- `deck.shuffle`
- `deck.draw_to_container`
- `entity.flip`
- `entity.grab`
- `entity.drop`

Kernel-v0 substitution: the `hand` component is registered but marked `stub`.
The release still includes it as metadata, while all canonical membership and
ordering behavior uses the implemented `container` component. Flip behavior is
the implemented `flippable.flipped` field. There is no win condition.

## Dice Dash

Dice Dash is a 2–4 player scripted race to the `targetScore` setting, which
defaults to 20. Release v2 uses the kernel's canonical `die.roll`; Lua observes
the committed value in `on_after_roll` and returns `counter.add`. The first
score to reach the target also produces `counter.set` on the canonical
`winner` counter. Release v1 retains its hidden six-token shuffle
implementation unchanged for pinned rooms and replay compatibility.

Registered kernel actions used:

- `system.game_start`
- `die.roll`
- `deck.shuffle`
- `counter.add`
- `counter.set`

Release-v1 substitutions (retained only for immutable v1 compatibility):

- `die` exists only as a stub component and there is no die-roll action, so a
  six-token deck is the RNG source. The visible die remains presentation data.
- The merged Lua package is a generic hardened sandbox; it has no `on_roll`,
  `random:int`, or proxy namespaces. The host therefore invokes the committed
  Lua source after the shuffle and injects only canonical callback data.
- No registered action can mutate `scriptState`. The implemented counter
  action stores the game-over result as `winner` (`0` while active, seat number
  after a win) instead of bypassing the kernel with an out-of-band mutation.
- Scripted transform movement and snap points are not implemented. Score
  advancement is represented by counters; markers remain freely movable via
  the existing player grab/drop actions.

No custom kernel action, component, callback API, or Lua namespace is added by
this package.

## Release integrity

Each bundle follows the Appendix D.2 manifest fields and adds `minPlayers` and
`maxPlayers` as release player bounds. File entries inline `content` for the
built-in serving path. `contentHash` is SHA-256 over the file's raw UTF-8 bytes;
`byteLength` is that byte sequence's length. `integrity.manifestHash` is the
canonical JSON hash of all manifest fields except the self-referential
`integrity` object, with file entries reduced to `path`, `contentHash`, and
`byteLength`.

These values are committed constants. Tests recompute every link in the
integrity chain. The builtin build command creates a new generated release but
refuses to rewrite an existing release with different bytes.

## Determinism fixtures

The committed replay fixtures contain real initial kernel snapshots, ordered
actions (including deliberate rejections), Lua callback expectations,
rejection counts, and pinned final state hashes. Dice Dash v2's fixture also
covers die rolling and player/seat lifecycle actions.

The tests:

- run each stream twice through the real kernel and Lua sandbox;
- match every Lua-generated action to the committed ordered stream;
- reconstruct from a midpoint snapshot with a fresh Lua host;
- verify the initial deal, Dice Dash winner, and replayed scores;
- audit every used action against the merged kernel registry; and
- load both Lua files under the sandbox's instruction and memory budgets.

Run them with:

```sh
bun test
bun run typecheck
```
