import type { ModelMessage, ModelRequest } from "./request";
import type { ModelFetch } from "./transport";

export interface Violation {
  code: string;
  message: string;
}

export interface StructuredTaskTelemetry {
  attempts: number;
  firstTryValid: boolean;
  retries: number;
  fallback: boolean;
  violations: Violation[];
}

/**
 * Progress events emitted while a structured task runs. Local 0.6B-class
 * generation takes minutes per attempt; these keep a long generation from
 * being a black box (callers log them to their own telemetry).
 */
export type StructuredTaskEvent =
  | {
      type: "attempt_started";
      attempt: number;
      maxAttempts: number;
      timeoutMs: number;
    }
  | {
      type: "attempt_finished";
      attempt: number;
      elapsedMs: number;
      /** valid: extracted and passed validation. invalid: extracted but rejected. unusable: no payload (timeout/transport/parse failure). */
      outcome: "valid" | "invalid" | "unusable";
      violations: Violation[];
    };

export interface RunStructuredTaskOptions<T> {
  fetch: ModelFetch;
  request: ModelRequest;
  extract: (response: unknown) => T | null;
  validate: (value: T) => Violation[];
  maxAttempts?: number;
  timeoutMs?: number;
  onProgress?: (event: StructuredTaskEvent) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
/** Bounded synchronous generation; callers can select a shorter deadline. */
const DEFAULT_TIMEOUT_MS = 180_000;

function attemptLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.floor(value));
}

function feedbackTurns<T>(
  value: T,
  violations: Violation[],
): ModelMessage[] | null {
  let payload: string;
  try {
    payload = JSON.stringify(value);
  } catch {
    return null;
  }
  const list = violations
    .map((violation) => `- [${violation.code}] ${violation.message}`)
    .join("\n");
  return [
    { role: "assistant", content: payload },
    {
      role: "user",
      content:
        `That payload was REJECTED by the validator:\n${list}\n\n` +
        `Fix every violation and re-emit the corrected payload as ONE raw JSON object — your entire message content, no prose, no markdown fences. /no_think`,
    },
  ];
}

function requestWithFeedback(
  request: ModelRequest,
  feedback: ModelMessage[] | null,
): ModelRequest {
  const next: ModelRequest = {
    ...request,
    messages: feedback === null ? [...request.messages] : [...request.messages, ...feedback],
  };
  if (request.tools !== undefined) next.tools = [...request.tools];
  if (request.tool_choice !== undefined) {
    next.tool_choice = {
      type: "function",
      function: { name: request.tool_choice.function.name },
    };
  }
  return next;
}

export async function runStructuredTask<T>(
  options: RunStructuredTaskOptions<T>,
): Promise<{ result: T | null; telemetry: StructuredTaskTelemetry }> {
  const maxAttempts = attemptLimit(options.maxAttempts);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let feedback: ModelMessage[] | null = null;
  let lastViolations: Violation[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    let value: T | null = null;
    options.onProgress?.({
      type: "attempt_started",
      attempt,
      maxAttempts,
      timeoutMs,
    });
    const attemptStarted = Date.now();
    try {
      const response = await options.fetch(
        requestWithFeedback(options.request, feedback),
        timeoutMs,
      );
      if (response !== null) value = options.extract(response);
    } catch {
      value = null;
    }
    const elapsedMs = Date.now() - attemptStarted;

    if (value === null) {
      options.onProgress?.({
        type: "attempt_finished",
        attempt,
        elapsedMs,
        outcome: "unusable",
        violations: [],
      });
      feedback = null;
      lastViolations = [];
      continue;
    }

    const violations = options.validate(value);
    if (violations.length === 0) {
      options.onProgress?.({
        type: "attempt_finished",
        attempt,
        elapsedMs,
        outcome: "valid",
        violations: [],
      });
      return {
        result: value,
        telemetry: {
          attempts,
          firstTryValid: attempt === 1,
          retries: Math.max(0, attempts - 1),
          fallback: false,
          violations: [],
        },
      };
    }

    options.onProgress?.({
      type: "attempt_finished",
      attempt,
      elapsedMs,
      outcome: "invalid",
      violations,
    });
    lastViolations = [...violations];
    feedback = feedbackTurns(value, violations);
  }

  return {
    result: null,
    telemetry: {
      attempts,
      firstTryValid: false,
      retries: Math.max(0, attempts - 1),
      fallback: true,
      violations: lastViolations,
    },
  };
}
