import { describe, expect, test } from "bun:test";
import {
  canonicalBytes,
  canonicalStringify,
  hashValue,
} from "digipology-canonical-json";
import canonicalStateFixture from "../fixtures/canonical-json-rng-state.json";
import shuffleFixtures from "../fixtures/sfc32-v1-shuffles.json";
import referenceFixtures from "../fixtures/sfc32-v1-vectors.json";
import {
  InvalidRngStateError,
  SFC32_V1,
  SFC32_V1_WARMUP_DRAWS,
  createRng,
  fromState,
  type RngState,
} from "./index";

function draws(seed: string | number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe("sfc32-v1 reference contract", () => {
  test("regenerates the committed 100-draw vectors", () => {
    expect(referenceFixtures.algorithm).toBe(SFC32_V1);
    expect(referenceFixtures.warmupDraws).toBe(SFC32_V1_WARMUP_DRAWS);
    expect(referenceFixtures.vectors).toHaveLength(5);

    for (const vector of referenceFixtures.vectors) {
      expect(vector.outputs).toHaveLength(100);
      expect(draws(vector.seed, 100)).toEqual(vector.outputs);
    }
  });

  test("regenerates the committed 52-card shuffle fixtures", () => {
    expect(shuffleFixtures.algorithm).toBe(SFC32_V1);
    expect(shuffleFixtures.vectors).toHaveLength(3);

    for (const vector of shuffleFixtures.vectors) {
      expect(createRng(vector.seed).shuffle(shuffleFixtures.deck)).toEqual(
        vector.shuffled,
      );
    }
  });

  test("identical string and numeric seeds produce identical streams", () => {
    for (const seed of ["digipology", "", "seed-1", "🎲", 0, -1, 123456789]) {
      expect(draws(seed, 256)).toEqual(draws(seed, 256));
    }
  });

  test("rejects non-integer and non-finite numeric seeds", () => {
    expect(() => createRng(0.5)).toThrow(TypeError);
    expect(() => createRng(Number.NaN)).toThrow(TypeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("state snapshots", () => {
  test("has canonical bytes and hashes stable across save/restore", () => {
    const fixture = canonicalStateFixture as unknown as {
      readonly seed: string;
      readonly advanceDraws: number;
      readonly state: RngState;
      readonly canonical: string;
      readonly canonicalBytes: readonly number[];
      readonly hash: string;
    };
    const original = createRng(fixture.seed);
    for (let index = 0; index < fixture.advanceDraws; index += 1) {
      original.next();
    }

    const snapshot = original.state();
    expect(snapshot).toEqual(fixture.state);
    expect(canonicalStringify(snapshot)).toBe(fixture.canonical);
    expect(canonicalBytes(snapshot)).toEqual(
      Uint8Array.from(fixture.canonicalBytes),
    );
    expect(hashValue(snapshot)).toBe(fixture.hash);

    const restoredState = JSON.parse(fixture.canonical) as RngState;
    const restored = fromState(restoredState);
    expect(canonicalStringify(restored.state())).toBe(fixture.canonical);
    expect(canonicalBytes(restored.state())).toEqual(
      Uint8Array.from(fixture.canonicalBytes),
    );
    expect(hashValue(restored.state())).toBe(fixture.hash);

    const originalContinuation = Array.from({ length: 128 }, () => original.next());
    const restoredContinuation = Array.from({ length: 128 }, () => restored.next());
    expect(restoredContinuation).toEqual(originalContinuation);
    expect(canonicalStringify(restored.state())).toBe(
      canonicalStringify(original.state()),
    );
    expect(hashValue(restored.state())).toBe(hashValue(original.state()));
  });

  test("resumes the second half of a 1000-draw stream exactly", () => {
    const straight = draws("resume-fixture", 1_000);
    const split = createRng("resume-fixture");
    const firstHalf = Array.from({ length: 500 }, () => split.next());
    const snapshot = split.state();
    const resumed = fromState(snapshot);
    const secondHalf = Array.from({ length: 500 }, () => resumed.next());

    expect(firstHalf).toEqual(straight.slice(0, 500));
    expect(secondHalf).toEqual(straight.slice(500));
    expect(snapshot.draws).toBe(500);
    expect(resumed.state().draws).toBe(1_000);
  });

  test("returns detached snapshot objects", () => {
    const rng = createRng(42);
    const expected = rng.state();
    const snapshot = rng.state();
    snapshot.state[0] = 0;
    snapshot.draws = 999;

    expect(rng.state()).toEqual(expected);
    expect(rng.state()).not.toBe(snapshot);
    expect(rng.state().state).not.toBe(snapshot.state);
  });

  test("accepts every uint32 endpoint in state", () => {
    const rng = fromState({
      algorithm: SFC32_V1,
      state: [0, 0xffff_ffff, 0, 0xffff_ffff],
      draws: 0,
    });
    expect(rng.state().state).toEqual([0, 0xffff_ffff, 0, 0xffff_ffff]);
  });

  test.each([
    [null, "not-an-object"],
    [{ algorithm: "future-v2", state: [0, 0, 0, 0], draws: 0 }, "unknown-algorithm"],
    [{ algorithm: SFC32_V1, state: [0, 0, 0], draws: 0 }, "malformed-state"],
    [{ algorithm: SFC32_V1, state: [0, 0, 0, 0, 0], draws: 0 }, "malformed-state"],
    [{ algorithm: SFC32_V1, state: [0, 0, -1, 0], draws: 0 }, "malformed-state"],
    [{ algorithm: SFC32_V1, state: [0, 0, 0.5, 0], draws: 0 }, "malformed-state"],
    [{ algorithm: SFC32_V1, state: [0, 0, Number.NaN, 0], draws: 0 }, "malformed-state"],
    [{ algorithm: SFC32_V1, state: [0, 0, 0x1_0000_0000, 0], draws: 0 }, "malformed-state"],
    [{ algorithm: SFC32_V1, state: [0, 0, 0, 0], draws: -1 }, "invalid-draw-count"],
    [{ algorithm: SFC32_V1, state: [0, 0, 0, 0], draws: 0.5 }, "invalid-draw-count"],
  ] as const)("rejects tampered state %#", (state, reason) => {
    try {
      fromState(state as unknown as RngState);
      throw new Error("expected fromState to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRngStateError);
      expect((error as InvalidRngStateError).reason).toBe(reason);
    }
  });
});

describe("bounded helpers", () => {
  test("int is inclusive at both ends", () => {
    const rng = createRng("inclusive");
    const seen = new Set<number>();
    for (let index = 0; index < 10_000; index += 1) {
      seen.add(rng.int(-2, 2));
    }
    expect([...seen].sort((left, right) => left - right)).toEqual([
      -2, -1, 0, 1, 2,
    ]);

    expect(rng.int(7, 7)).toBe(7);
    expect(rng.int(0, 0xffff_ffff)).toBeGreaterThanOrEqual(0);
  });

  test("int rejects invalid bounds", () => {
    const rng = createRng(1);
    expect(() => rng.int(2, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(TypeError);
    expect(() => rng.int(0, Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => rng.int(0, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  test("int(0, 2^32 - 2) rejects the upper uint32 without hanging", () => {
    const rng = fromState({
      algorithm: SFC32_V1,
      state: [0xffff_ffff, 0, 0, 0xffff_ffff],
      draws: 0,
    });

    expect(rng.int(0, 0xffff_fffe)).toBe(1);
    expect(rng.state().draws).toBe(2);
  });

  test("int(0, 2) has a sane distribution over 100k samples", () => {
    const rng = createRng("distribution-int");
    const counts = [0, 0, 0];
    for (let index = 0; index < 100_000; index += 1) {
      const value = rng.int(0, 2);
      counts[value] = (counts[value] ?? 0) + 1;
    }

    for (const count of counts) {
      expect(Math.abs(count - 100_000 / 3)).toBeLessThan(1_500);
    }
  });

  test("float stays in [0, 1) over 100k samples", () => {
    const rng = createRng("distribution-float");
    for (let index = 0; index < 100_000; index += 1) {
      const value = rng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("choice returns members and rejects an empty array", () => {
    const values = ["a", "b", "c"] as const;
    const rng = createRng("choice");
    for (let index = 0; index < 100; index += 1) {
      expect(values).toContain(rng.choice(values));
    }
    expect(() => rng.choice([])).toThrow(RangeError);
  });

  test("shuffle returns a permutation without mutating its input", () => {
    const input = Array.from({ length: 52 }, (_, index) => index);
    const original = input.slice();
    const shuffled = createRng("immutable-shuffle").shuffle(input);

    expect(input).toEqual(original);
    expect(shuffled).not.toBe(input);
    expect(shuffled.slice().sort((left, right) => left - right)).toEqual(input);
  });
});
