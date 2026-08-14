# digipology-demo-games

Immutable, zero-runtime-dependency release bundles for the games that make a
fresh Digipology deployment playable before uploaded releases exist. The
catalog is pure TypeScript data: the runtime files and Lua sources are inlined,
and the worker can import them without filesystem or R2 access.

```ts
import { BUILTIN_GAMES, getBuiltinRelease } from "digipology-demo-games";

const release = getBuiltinRelease("builtin_first_deal_1");
```

`BUILTIN_GAMES` contains exactly `first-deal` and `dice-dash`. Release IDs and
release number 1 are pinned; editing content requires a new release and new
golden fixture rather than updating an existing hash.

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
defaults to 20. Each seat has a score counter and movable table marker. A real
kernel `deck.shuffle` randomizes a hidden six-token roll source; the token at
the top supplies a value from 1 through 6. Lua receives that committed value
in `on_after_shuffle` and returns `counter.add`. The first score to reach the
target also produces `counter.set` on the canonical `winner` counter.

Registered kernel actions used:

- `system.game_start`
- `deck.shuffle`
- `counter.add`
- `counter.set`

Kernel-v0 substitutions:

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
integrity chain; there is intentionally no build step that rewrites hashes.

## Determinism fixtures

`fixtures/first-deal-replay-v1.json` and
`fixtures/dice-dash-replay-v1.json` each contain a real initial kernel snapshot,
an ordered stream of at least 40 actions (including deliberate rejections), Lua
callback expectations, a rejection count, and a pinned final state hash.

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
