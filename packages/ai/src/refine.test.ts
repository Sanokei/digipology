import { describe, expect, test } from "bun:test";
import {
  runIterativeRefinement,
  type QualityIssue,
  type RefinementEvent,
  type RunIterativeRefinementOptions,
} from "./refine";
import type { ModelFetch } from "./transport";
import type { ModelRequest } from "./request";

/** Test value: a payload plus a marker list the fake quality check reads. */
interface Widget {
  errors: string[];
  note: string;
}
interface WidgetPatch {
  fix: string[];
  add?: string[];
}

const request: ModelRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "make a widget" }],
};

function scriptedFetch(responses: Array<{ value?: unknown } | null>): {
  fetch: ModelFetch;
  calls: ModelRequest[];
} {
  const calls: ModelRequest[] = [];
  let index = 0;
  const fetch: ModelFetch = async (payload) => {
    calls.push(payload);
    const next = index < responses.length ? responses[index] : null;
    index += 1;
    if (next === null || next === undefined) return null;
    return next.value === undefined ? null : next.value;
  };
  return { fetch, calls };
}

function baseOptions(
  fetch: ModelFetch,
  qualityCheck: (value: Widget) => QualityIssue[],
  events: RefinementEvent[],
  extra?: Partial<RunIterativeRefinementOptions<Widget, WidgetPatch>>,
): RunIterativeRefinementOptions<Widget, WidgetPatch> {
  return {
    fetch,
    initial: {
      request,
      extract: (response) => (response as { widget?: Widget } | null)?.widget ?? null,
      validate: () => [],
    },
    qualityCheck,
    buildRefinementRequest: (value, issues) => ({
      model: "test-model",
      messages: [
        { role: "user", content: `fix ${issues.map((i) => i.code).join(",")} in ${value.note}` },
      ],
    }),
    extractRefinement: (response) =>
      (response as { patch?: WidgetPatch } | null)?.patch ?? null,
    validateRefinement: (patch) =>
      patch.fix.length === 0
        ? [{ code: "empty_patch", message: "patch fixes nothing" }]
        : [],
    applyRefinement: (value, patch) => ({
      note: value.note,
      errors: value.errors.filter((error) => !patch.fix.includes(error)),
    }),
    onProgress: (event) => events.push(event),
    ...extra,
  };
}

const issue = (code: string): QualityIssue => ({
  code,
  message: `${code} is wrong`,
  severity: "error",
});

describe("runIterativeRefinement", () => {
  test("returns the initial value untouched when it already passes", async () => {
    const { fetch, calls } = scriptedFetch([{ value: { widget: { errors: [], note: "v1" } } }]);
    const events: RefinementEvent[] = [];
    const result = await runIterativeRefinement(
      baseOptions(fetch, () => [], events),
    );
    expect(result.value).toEqual({ errors: [], note: "v1" });
    expect(result.rounds).toBe(0);
    expect(result.accepted).toBe(true);
    expect(result.refinementCalls).toBe(0);
    expect(calls).toHaveLength(1);
    const types = events.map((event) => event.type);
    expect(types).toContain("round_started");
    expect(types).toContain("quality_checked");
    expect(types).toContain("refinement_done");
    expect(types).not.toContain("refinement_started");
  });

  test("refines once and accepts when the error count drops to zero", async () => {
    const { fetch, calls } = scriptedFetch([
      { value: { widget: { errors: ["a", "b"], note: "v1" } } },
      { value: { patch: { fix: ["a", "b"] } } },
    ]);
    const events: RefinementEvent[] = [];
    const result = await runIterativeRefinement(
      baseOptions(
        fetch,
        (value) => value.errors.map(issue),
        events,
      ),
    );
    expect(result.value).toEqual({ errors: [], note: "v1" });
    expect(result.rounds).toBe(1);
    expect(result.accepted).toBe(true);
    expect(result.refinementCalls).toBe(1);
    expect(calls).toHaveLength(2);
    // The refinement request carries only the blocking issues, not a full redraft.
    expect(calls[1]!.messages[0]!.content).toContain("fix a,b");
    const finished = events.filter((event) => event.type === "refinement_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ outcome: "accepted" });
  });

  test("runs all rounds and returns the best value when nothing improves", async () => {
    const { fetch } = scriptedFetch([
      { value: { widget: { errors: ["a"], note: "v1" } } },
      { value: { patch: { fix: [] } } },
      { value: { patch: { fix: [] } } },
      { value: { patch: { fix: [] } } },
      { value: { patch: { fix: [] } } },
    ]);
    const result = await runIterativeRefinement(
      baseOptions(fetch, (value) => value.errors.map(issue), [], {
        maxRounds: 2,
        refinementAttempts: 2,
      }),
    );
    expect(result.rounds).toBe(2);
    expect(result.refinementCalls).toBe(4);
    expect(result.accepted).toBe(false);
    expect(result.value).toEqual({ errors: ["a"], note: "v1" });
  });

  test("respects maxRounds when every round improves but never clears", async () => {
    const scripted: Array<{ value?: unknown } | null> = [
      { value: { widget: { errors: ["a", "b", "c", "d"], note: "v1" } } },
    ];
    for (let round = 0; round < 5; round += 1) {
      scripted.push({ value: { patch: { fix: [`${"abcd"[round]}`] } } });
    }
    const { fetch } = scriptedFetch(scripted);
    const result = await runIterativeRefinement(
      baseOptions(fetch, (value) => value.errors.map(issue), [], { maxRounds: 3 }),
    );
    expect(result.rounds).toBe(3);
    expect(result.refinementCalls).toBe(3);
    expect(result.value).toEqual({ errors: ["d"], note: "v1" });
    expect(result.accepted).toBe(false);
  });

  test("returns null when generation itself fails", async () => {
    const { fetch } = scriptedFetch([null, null, null]);
    const events: RefinementEvent[] = [];
    const result = await runIterativeRefinement(
      baseOptions(fetch, () => [issue("x")], events),
    );
    expect(result.value).toBeNull();
    expect(result.accepted).toBe(false);
    expect(result.generationTelemetry?.fallback).toBe(true);
    expect(events.some((event) => event.type === "refinement_started")).toBe(false);
  });

  test("treats an unappliable patch as rejected and retries", async () => {
    const { fetch } = scriptedFetch([
      { value: { widget: { errors: ["a"], note: "v1" } } },
      { value: { patch: { fix: ["a"] } } },
      { value: { patch: { fix: ["a"] } } },
    ]);
    let applyCalls = 0;
    const result = await runIterativeRefinement(
      baseOptions(fetch, (value) => value.errors.map(issue), [], {
        refinementAttempts: 2,
        applyRefinement: (value, patch) => {
          applyCalls += 1;
          if (applyCalls === 1) return null; // first patch cannot apply
          return {
            note: value.note,
            errors: value.errors.filter((error) => !patch.fix.includes(error)),
          };
        },
      }),
    );
    expect(result.accepted).toBe(true);
    expect(result.value).toEqual({ errors: [], note: "v1" });
    expect(result.refinementCalls).toBe(2);
  });

  test("recovers in a later round after a patch that makes things worse", async () => {
    const { fetch } = scriptedFetch([
      { value: { widget: { errors: ["a"], note: "v1" } } },
      // Round 1 attempt 1: invalid patch, rejected without touching the value.
      { value: { patch: { fix: [] } } },
      // Round 1 attempt 2: applies cleanly but adds new errors — working value
      // advances, best stays put, outcome is "rejected".
      { value: { patch: { fix: ["a"], add: ["x", "y"] } } },
      // Round 2: refines the worse working value back to clean.
      { value: { patch: { fix: ["x", "y"] } } },
    ]);
    const events: RefinementEvent[] = [];
    const result = await runIterativeRefinement(
      baseOptions(fetch, (value) => value.errors.map(issue), events, {
        maxRounds: 3,
        refinementAttempts: 2,
        applyRefinement: (value, patch) => ({
          note: value.note,
          errors: [
            ...value.errors.filter((error) => !patch.fix.includes(error)),
            ...(patch.add ?? []),
          ],
        }),
      }),
    );
    expect(result.accepted).toBe(true);
    expect(result.value).toEqual({ errors: [], note: "v1" });
    expect(result.rounds).toBe(2);
    expect(result.refinementCalls).toBe(3);
    const finished = events.filter((event) => event.type === "refinement_finished");
    expect(finished.map((event) => event.type === "refinement_finished" && event.outcome))
      .toEqual(["rejected", "rejected", "accepted"]);
  });

  test("re-emits generation progress events", async () => {
    const { fetch } = scriptedFetch([{ value: { widget: { errors: [], note: "v1" } } }]);
    const events: RefinementEvent[] = [];
    await runIterativeRefinement(baseOptions(fetch, () => [], events));
    const generation = events.filter((event) => event.type === "generation");
    expect(generation.length).toBeGreaterThan(0);
    expect(generation[0]).toMatchObject({
      type: "generation",
      event: { type: "attempt_started", attempt: 1 },
    });
  });
});
