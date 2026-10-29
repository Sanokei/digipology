import { describe, expect, test } from "bun:test";

import { runStructuredTask, type StructuredTaskEvent, type Violation } from "./loop";
import type { ModelRequest } from "./request";
import type { ModelFetch } from "./transport";

interface FixtureValue {
  id: number;
  valid: boolean;
}

const baseRequest: ModelRequest = {
  model: "deepseek-v4-flash",
  messages: [
    { role: "system", content: "Return a value." },
    { role: "user", content: "Make it valid." },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "emit_value",
        description: "Emit a value",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "emit_value" } },
};

function extract(response: unknown): FixtureValue | null {
  if (!response || typeof response !== "object") return null;
  const value = response as Partial<FixtureValue>;
  return typeof value.id === "number" && typeof value.valid === "boolean"
    ? { id: value.id, valid: value.valid }
    : null;
}

function validate(value: FixtureValue): Violation[] {
  return value.valid
    ? []
    : [{ code: `invalid_${value.id}`, message: `Value ${value.id} is invalid` }];
}

describe("runStructuredTask", () => {
  test("accepts a first-try valid value with exact telemetry", async () => {
    const timeouts: number[] = [];
    const fetch: ModelFetch = async (_request, timeoutMs) => {
      timeouts.push(timeoutMs);
      return { id: 1, valid: true };
    };
    const outcome = await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
      timeoutMs: 1234,
    });

    expect(outcome).toEqual({
      result: { id: 1, valid: true },
      telemetry: {
        attempts: 1,
        firstTryValid: true,
        retries: 0,
        fallback: false,
        violations: [],
      },
    });
    expect(timeouts).toEqual([1234]);
  });

  test("feeds a rejected payload and typed violations into attempt 2", async () => {
    const requests: ModelRequest[] = [];
    const replies: FixtureValue[] = [
      { id: 1, valid: false },
      { id: 2, valid: true },
    ];
    const fetch: ModelFetch = async (request) => {
      requests.push(request);
      return replies[requests.length - 1] ?? null;
    };
    const outcome = await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
    });

    expect(outcome.telemetry).toEqual({
      attempts: 2,
      firstTryValid: false,
      retries: 1,
      fallback: false,
      violations: [],
    });
    expect(requests[0]?.messages).toEqual(baseRequest.messages);
    expect(requests[1]?.messages.slice(-2)).toEqual([
      { role: "assistant", content: '{"id":1,"valid":false}' },
      {
        role: "user",
        content:
          "That payload was REJECTED by the validator:\n" +
          "- [invalid_1] Value 1 is invalid\n\n" +
          "Fix every violation and re-emit the corrected payload as ONE raw JSON object — your entire message content, no prose, no markdown fences. /no_think",
      },
    ]);
    expect(baseRequest.messages).toHaveLength(2);
  });

  test("falls back after the default three attempts with last violations", async () => {
    let calls = 0;
    const fetch: ModelFetch = async () => {
      calls += 1;
      return { id: calls, valid: false };
    };
    const outcome = await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
    });

    expect(calls).toBe(3);
    expect(outcome).toEqual({
      result: null,
      telemetry: {
        attempts: 3,
        firstTryValid: false,
        retries: 2,
        fallback: true,
        violations: [{ code: "invalid_3", message: "Value 3 is invalid" }],
      },
    });
  });

  test("an unparseable middle attempt resets feedback", async () => {
    const requests: ModelRequest[] = [];
    const replies: unknown[] = [
      { id: 1, valid: false },
      { malformed: true },
      { id: 3, valid: true },
    ];
    const fetch: ModelFetch = async (request) => {
      requests.push(request);
      return replies[requests.length - 1] ?? null;
    };
    const outcome = await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
    });

    expect(requests[1]?.messages).toHaveLength(4);
    expect(requests[2]?.messages).toEqual(baseRequest.messages);
    expect(outcome.telemetry).toEqual({
      attempts: 3,
      firstTryValid: false,
      retries: 2,
      fallback: false,
      violations: [],
    });
  });

  test("transport null and thrown failures are unusable attempts", async () => {
    let calls = 0;
    const fetch: ModelFetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error("upstream failed");
      return null;
    };
    const outcome = await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
      maxAttempts: 2,
    });
    expect(outcome).toEqual({
      result: null,
      telemetry: {
        attempts: 2,
        firstTryValid: false,
        retries: 1,
        fallback: true,
        violations: [],
      },
    });
  });

  test("the default timeout bounds synchronous generation to three minutes", async () => {
    const timeouts: number[] = [];
    const fetch: ModelFetch = async (_request, timeoutMs) => {
      timeouts.push(timeoutMs);
      return { id: 1, valid: true };
    };
    await runStructuredTask({ fetch, request: baseRequest, extract, validate });
    expect(timeouts).toEqual([180_000]);
  });

  test("onProgress reports attempt lifecycle with outcomes", async () => {
    const events: StructuredTaskEvent[] = [];
    const replies: unknown[] = [null, { id: 2, valid: true }];
    let calls = 0;
    const fetch: ModelFetch = async () => replies[calls++] ?? null;
    const outcome = await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
      maxAttempts: 2,
      timeoutMs: 5_000,
      onProgress: (event) => events.push(event),
    });

    expect(outcome.result).toEqual({ id: 2, valid: true });
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      type: "attempt_started",
      attempt: 1,
      maxAttempts: 2,
      timeoutMs: 5_000,
    });
    expect(events[1]).toMatchObject({
      type: "attempt_finished",
      attempt: 1,
      outcome: "unusable",
      violations: [],
    });
    expect(events[2]).toEqual({
      type: "attempt_started",
      attempt: 2,
      maxAttempts: 2,
      timeoutMs: 5_000,
    });
    expect(events[3]).toMatchObject({
      type: "attempt_finished",
      attempt: 2,
      outcome: "valid",
      violations: [],
    });
    for (const event of events) {
      if (event.type === "attempt_finished") {
        expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("onProgress marks a rejected payload as invalid with its violations", async () => {
    const events: StructuredTaskEvent[] = [];
    const fetch: ModelFetch = async () => ({ id: 9, valid: false });
    await runStructuredTask({
      fetch,
      request: baseRequest,
      extract,
      validate,
      maxAttempts: 1,
      onProgress: (event) => events.push(event),
    });
    expect(events[1]).toMatchObject({
      type: "attempt_finished",
      attempt: 1,
      outcome: "invalid",
      violations: [{ code: "invalid_9", message: "Value 9 is invalid" }],
    });
  });

  test("feedback turns stay tool-free when the request carries no tools", async () => {
    const requests: ModelRequest[] = [];
    const replies: FixtureValue[] = [
      { id: 1, valid: false },
      { id: 2, valid: true },
    ];
    const fetch: ModelFetch = async (request) => {
      requests.push(request);
      return replies[requests.length - 1] ?? null;
    };
    const toolFree: ModelRequest = {
      model: "qwen3",
      messages: [{ role: "user", content: "Emit JSON." }],
    };
    await runStructuredTask({ fetch, request: toolFree, extract, validate });
    expect(requests[1]?.tools).toBeUndefined();
    expect(requests[1]?.tool_choice).toBeUndefined();
    const feedback = requests[1]?.messages.at(-1);
    expect(feedback?.content).toContain("/no_think");
  });
});
