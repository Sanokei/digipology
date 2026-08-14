import { describe, expect, test } from "bun:test";

import { runStructuredTask, type Violation } from "./loop";
import type { DeepSeekRequest } from "./request";
import type { DeepseekFetch } from "./transport";

interface FixtureValue {
  id: number;
  valid: boolean;
}

const baseRequest: DeepSeekRequest = {
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
    const fetch: DeepseekFetch = async (_request, timeoutMs) => {
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
    const requests: DeepSeekRequest[] = [];
    const replies: FixtureValue[] = [
      { id: 1, valid: false },
      { id: 2, valid: true },
    ];
    const fetch: DeepseekFetch = async (request) => {
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
          "Fix every violation and re-emit the corrected payload through emit_value — no prose.",
      },
    ]);
    expect(baseRequest.messages).toHaveLength(2);
  });

  test("falls back after the default three attempts with last violations", async () => {
    let calls = 0;
    const fetch: DeepseekFetch = async () => {
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
    const requests: DeepSeekRequest[] = [];
    const replies: unknown[] = [
      { id: 1, valid: false },
      { malformed: true },
      { id: 3, valid: true },
    ];
    const fetch: DeepseekFetch = async (request) => {
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
    const fetch: DeepseekFetch = async () => {
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
});
