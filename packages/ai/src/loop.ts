import type { DeepSeekMessage, DeepSeekRequest } from "./request";
import type { DeepseekFetch } from "./transport";

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

export interface RunStructuredTaskOptions<T> {
  fetch: DeepseekFetch;
  request: DeepSeekRequest;
  extract: (response: unknown) => T | null;
  validate: (value: T) => Violation[];
  maxAttempts?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

function attemptLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.floor(value));
}

function feedbackTurns<T>(
  value: T,
  violations: Violation[],
  toolName: string,
): DeepSeekMessage[] | null {
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
        `Fix every violation and re-emit the corrected payload through ${toolName} — no prose.`,
    },
  ];
}

function requestWithFeedback(
  request: DeepSeekRequest,
  feedback: DeepSeekMessage[] | null,
): DeepSeekRequest {
  return {
    ...request,
    messages: feedback === null ? [...request.messages] : [...request.messages, ...feedback],
    tools: [...request.tools],
    tool_choice: {
      type: "function",
      function: { name: request.tool_choice.function.name },
    },
  };
}

export async function runStructuredTask<T>(
  options: RunStructuredTaskOptions<T>,
): Promise<{ result: T | null; telemetry: StructuredTaskTelemetry }> {
  const maxAttempts = attemptLimit(options.maxAttempts);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let feedback: DeepSeekMessage[] | null = null;
  let lastViolations: Violation[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    let value: T | null = null;
    try {
      const response = await options.fetch(
        requestWithFeedback(options.request, feedback),
        timeoutMs,
      );
      if (response !== null) value = options.extract(response);
    } catch {
      value = null;
    }

    if (value === null) {
      feedback = null;
      lastViolations = [];
      continue;
    }

    const violations = options.validate(value);
    if (violations.length === 0) {
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

    lastViolations = [...violations];
    feedback = feedbackTurns(
      value,
      violations,
      options.request.tool_choice.function.name,
    );
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
