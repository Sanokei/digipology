# digipology-canonical-json

Deterministic canonical JSON serialization and synchronous SHA-256 hashing for
Digipology gameplay state, checkpoints, and release manifests. The package is
pure TypeScript and has zero runtime dependencies or platform API usage.

## API

```ts
import {
  canonicalBytes,
  canonicalStringify,
  CanonicalizationError,
  hashValue,
  sha256,
} from "digipology-canonical-json";

const canonical = canonicalStringify({ b: 2, a: 1 });
// {"a":1,"b":2}

const stateHash = hashValue({ b: 2, a: 1 });
// sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777
```

- `canonicalStringify(value: unknown): string` serializes a compatible value.
- `canonicalBytes(value: unknown): Uint8Array` returns the canonical string's
  UTF-8 bytes.
- `sha256(bytes: Uint8Array): Uint8Array` computes SHA-256 synchronously using
  a pure TypeScript FIPS 180-4 implementation.
- `hashValue(value: unknown): string` returns `sha256:` followed by the
  lowercase hexadecimal digest of the canonical bytes.

Invalid input throws `CanonicalizationError`. Its `path` is a JSON path rooted
at `$`, and its `reason` is one of `nan`, `infinity`, `function`, `undefined`,
`cycle`, `non-string-key`, or `unsupported-type`. Symbol-keyed properties have
no JSON-path key representation, so their error path identifies the containing
array or object.

## Serialization contract

- Object keys sorted by UTF-16 code unit order (standard JS `<` on strings); output encoded as UTF-8. Arrays serialize in order.
- Accepted values: `null`, booleans, finite numbers, strings, arrays, plain string-keyed objects. Everything else (`undefined`, functions, symbols, BigInt, Map/Set, class instances beyond plain objects, cyclic graphs) is rejected with `CanonicalizationError` including the JSON path.
- `NaN` / `Infinity` / `-Infinity` rejected. `-0` normalized to `0`.
- Number formatting: shortest round-trip representation per ECMAScript `Number::toString(x, 10)`. Document explicitly that ECMA-262 fully specifies this algorithm, so all conforming JS engines produce identical output — this is the load-bearing fact that makes cross-browser hashing viable (RISK-001). Integer-valued doubles serialize without a decimal point (`3`, not `3.0`); non-integers use the engine's shortest form (`0.1`, `1e21`, etc.).
- Strings escaped per JSON with a fixed escaping policy (escape only the mandatory characters: `"` `\\` and control chars < 0x20, using `\uXXXX` lowercase-hex form for controls without short escapes). No optional escaping, so output is unique.
- No whitespace anywhere in output.

The exponent sign emitted by `Number::toString` is retained, so `1e21` as a
number serializes as `1e+21`. This follows ECMA-262 rather than applying a
second, package-specific number rewrite.

JavaScript strings are UTF-16 and may contain unpaired surrogate code units.
For the escaping policy above, an unpaired surrogate is treated as requiring
an escape: it serializes as a lowercase `\uXXXX` sequence. A valid high/low
surrogate pair is emitted as the original astral-plane character and encoded
as its four UTF-8 bytes. This lossless rule prevents an unpaired surrogate from
being replaced by U+FFFD during UTF-8 encoding and colliding with a literal
replacement character.

Only ordinary own, enumerable data properties are canonical-compatible.
Sparse arrays, custom array properties, accessors, and non-enumerable object
properties are rejected rather than silently invoking code or discarding data.
Shared acyclic references are allowed and serialize at every location; only a
reference back into the active ancestor chain is a cycle.

## Determinism and compatibility

The serializer does not call `JSON.stringify` and never relies on object
insertion order. UTF-8 encoding and SHA-256 are implemented locally without
`TextEncoder`, WebCrypto, Node crypto, or other host APIs. The same source can
therefore be bundled for browsers, Bun, Node, and Cloudflare Workers.

The committed files in `fixtures/` contain canonical strings and SHA-256
hashes. They are a cross-package byte-level compatibility contract: changing a
fixture result is a serialization-format change, not a routine refactor.
