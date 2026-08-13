# digipology-prng

`digipology-prng` supplies canonical gameplay randomness for Digipology. It is
a pure, zero-runtime-dependency TypeScript package. It is deterministic, but it
is **not cryptographically secure**; session tokens and join codes must use a
platform CSPRNG instead.

## API

```ts
import { createRng, fromState } from "digipology-prng";

const rng = createRng("table-42");
const die = rng.int(1, 6);
const saved = rng.state();
const resumed = fromState(saved);
```

`next()` returns one uint32 in `[0, 2^32)`. `float()` divides one `next()`
result by exactly `2^32`, producing one of `2^32` equally spaced values in
`[0, 1)` with 32 bits of entropy. `int(min, max)` accepts safe-integer bounds,
is inclusive at both ends, and supports intervals of at most `2^32` values.
It uses rejection sampling: values at or above
`floor(2^32 / rangeSize) * rangeSize` are discarded before applying modulo.
The worst case is a range of `2^31 + 1`, for which the expected draw count is
just under 2; every other supported range is no worse.

`choice(array)` uses `int(0, array.length - 1)` and rejects an empty array.
`shuffle(array)` is Fisher-Yates from the final element to index 1, calling
`int(0, i)` exactly once for each accepted swap index. It returns a new array
and never mutates its input. Rejection sampling can make a swap consume more
than one raw draw.

`state()` returns a detached snapshot with this canonical compatibility shape:

```ts
interface RngState {
  algorithm: "sfc32-v1";
  state: [number, number, number, number];
  draws: number;
}
```

The four state words are ordinary finite uint32 numbers. `draws` counts raw
`next()` calls made through the public API, including calls made by `float`,
`int`, `choice`, and `shuffle` (and rejected samples). The internal seeding
warm-up is not gameplay consumption and starts this counter at zero.

## Frozen `sfc32-v1` definition

SFC32 was selected because its compact four-word state is easy to snapshot and
its core uses only portable 32-bit add, XOR, shift, and rotate operations. It
does not require `BigInt` and has no runtime or platform dependency.

Seeding is fully specified:

1. A numeric seed must be a safe integer and its low 32 bits (`seed >>> 0`) are
   the initial SplitMix32 state.
2. A string seed is encoded as UTF-8 and folded with FNV-1a, using offset basis
   `0x811c9dc5` and prime `0x01000193`. Each multiply uses `Math.imul`. Unpaired
   UTF-16 surrogates encode as the replacement scalar U+FFFD.
3. SplitMix32 is advanced four times. Each advance adds `0x9e3779b9`, then
   applies XOR-shift 16, multiply `0x21f0aaad`, XOR-shift 15, multiply
   `0x735a2d97`, and a final XOR-shift 15. The four results become `a,b,c,d`.
4. Exactly 12 SFC32 core outputs are discarded. These warm-up steps are not
   included in the public `draws` counter.

Each SFC32 core step, in order, computes `t = a + b`, assigns
`a = b ^ (b >>> 9)`, assigns `b = c + (c << 3)`, rotates `c` left by 21,
increments `d`, adds the new `d` to `t`, adds `t` to `c`, and returns `t` as a
uint32. Every assignment is reduced to 32 bits.

The committed reference and shuffle vectors in `fixtures/` are the normative
cross-runtime examples for this definition.

## Versioning policy

The algorithm identifier covers every observable behavior: string encoding,
seed folding, SplitMix32 expansion, warm-up count, core step, draw accounting,
integer rejection, and shuffle order. Once published, `sfc32-v1` is frozen
forever. Any behavior change requires a new `algorithm` string and separate
compatibility implementation; existing snapshots must continue to use this
version unchanged.
