import type { ModelRequest } from "./request";
import type { ModelFetch } from "./transport";
import {
  runStructuredTask,
  type RunStructuredTaskOptions,
  type StructuredTaskEvent,
  type StructuredTaskTelemetry,
  type Violation,
} from "./loop";

/**
 * A single quality finding about a generated value. `error` findings block
 * acceptance and drive refinement; `warning` findings are reported but do not
 * block. Messages should be concrete enough to paste into a refinement prompt.
 */
export interface QualityIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Progress events for the whole generate -> quality-check -> refine pipeline.
 * Generation attempts are re-emitted verbatim inside the `generation` variant
 * so callers keep the per-attempt visibility runStructuredTask provides.
 */
export type RefinementEvent =
  | { type: "generation"; event: StructuredTaskEvent }
  | { type: "round_started"; round: number; maxRounds: number }
  | { type: "quality_checked"; round: number; issues: QualityIssue[] }
  | {
      type: "refinement_started";
      round: number;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: "refinement_finished";
      round: number;
      attempt: number;
      elapsedMs: number;
      /** accepted: patch applied and error count dropped. rejected: patch unusable, invalid, or not an improvement. unusable: no patch (timeout/transport/parse). */
      outcome: "accepted" | "rejected" | "unusable";
      violations: Violation[];
    }
  | { type: "refinement_done"; rounds: number; accepted: boolean };

export interface RunIterativeRefinementOptions<T, P> {
  fetch: ModelFetch;
  /** Initial generation task (structure + structural validation). */
  initial: Omit<RunStructuredTaskOptions<T>, "fetch" | "onProgress">;
  /**
   * Quality gate beyond structural validity. Runs on the initial value and
   * after every accepted patch. May be async (e.g. execute code, playtest).
   */
  qualityCheck: (value: T) => Promise<QualityIssue[]> | QualityIssue[];
  /**
   * Build the small, targeted refinement request for this round: the current
   * value's relevant slice plus its quality issues — NOT a full regeneration
   * prompt. Receives all issues; the builder decides how to present errors
   * (must fix) vs warnings (guidance). Keep it small: at a few tokens/sec,
   * context size is wall-clock.
   */
  buildRefinementRequest: (value: T, issues: QualityIssue[]) => ModelRequest;
  extractRefinement: (response: unknown) => P | null;
  validateRefinement: (patch: P) => Violation[];
  /**
   * Merge a validated patch into the current value. Return null when the
   * patch cannot be applied (counts as a rejected refinement attempt).
   */
  applyRefinement: (value: T, patch: P) => T | null;
  /** Refinement rounds after the initial quality check. Default 3. */
  maxRounds?: number;
  /** Model attempts per refinement round. Default 2. */
  refinementAttempts?: number;
  /** Per-attempt timeout for refinement calls. Default 15 minutes. */
  timeoutMs?: number;
  onProgress?: (event: RefinementEvent) => void;
}

export interface IterativeRefinementResult<T> {
  /** Best value seen (initial value if refinement never improved it). Null when generation itself failed. */
  value: T | null;
  /** Refinement rounds run (0 when the initial value already passed). */
  rounds: number;
  /** Quality issues on the returned value. */
  issues: QualityIssue[];
  /** True when the returned value has zero error-severity issues. */
  accepted: boolean;
  generationTelemetry: StructuredTaskTelemetry | null;
  /** Model calls spent on refinement (excludes generation attempts). */
  refinementCalls: number;
}

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_REFINEMENT_ATTEMPTS = 2;
/**
 * Refinement outputs are small (a patch, not a full draft), so the default is
 * much shorter than runStructuredTask's generation default while still sized
 * for a few-tokens/sec local model.
 */
const DEFAULT_REFINEMENT_TIMEOUT_MS = 900_000;

function boundedInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function errorCount(issues: readonly QualityIssue[]): number {
  return issues.filter((issue) => issue.severity === "error").length;
}

/**
 * Generate -> validate structure -> quality-check -> critique -> refine.
 *
 * The initial value comes from runStructuredTask (structural validity). Each
 * refinement round feeds the working value plus its quality issues back to the
 * model and asks for a small patch; the patch is applied, structurally
 * re-validated by applyRefinement, and re-checked. Any cleanly-applied patch
 * becomes the new working value (its issues are the next round's fuel), while
 * the best value seen is tracked separately and returned at the end — the
 * loop never returns something worse than its starting point. Rounds stop
 * early only when the working value is clean. Everything is bounded:
 * maxRounds x refinementAttempts model calls at most.
 *
 * Provider-neutral: model I/O goes through ModelFetch/ModelRequest, quality
 * checks and patch application are caller-supplied.
 */
export async function runIterativeRefinement<T, P>(
  options: RunIterativeRefinementOptions<T, P>,
): Promise<IterativeRefinementResult<T>> {
  const maxRounds = boundedInt(options.maxRounds, DEFAULT_MAX_ROUNDS);
  const refinementAttempts = boundedInt(
    options.refinementAttempts,
    DEFAULT_REFINEMENT_ATTEMPTS,
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_REFINEMENT_TIMEOUT_MS;
  const emit = (event: RefinementEvent): void => options.onProgress?.(event);
  let refinementCalls = 0;

  const task = await runStructuredTask<T>({
    ...options.initial,
    fetch: options.fetch,
    onProgress: (event) => emit({ type: "generation", event }),
  });
  if (task.result === null) {
    emit({ type: "refinement_done", rounds: 0, accepted: false });
    return {
      value: null,
      rounds: 0,
      issues: [],
      accepted: false,
      generationTelemetry: task.telemetry,
      refinementCalls,
    };
  }

  let best = task.result;
  let bestIssues = await options.qualityCheck(best);
  // current/currentIssues: the working value. Any cleanly-applied patch
  // advances it (even when worse than best); best/bestIssues track the winner
  // so the loop can never return something worse than its starting point.
  let current = best;
  let currentIssues = bestIssues;
  emit({ type: "round_started", round: 0, maxRounds });
  emit({ type: "quality_checked", round: 0, issues: currentIssues });
  if (errorCount(currentIssues) === 0) {
    emit({ type: "refinement_done", rounds: 0, accepted: true });
    return {
      value: best,
      rounds: 0,
      issues: bestIssues,
      accepted: true,
      generationTelemetry: task.telemetry,
      refinementCalls,
    };
  }

  let rounds = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    emit({ type: "round_started", round, maxRounds });
    const request = options.buildRefinementRequest(current, currentIssues);
    for (let attempt = 1; attempt <= refinementAttempts; attempt += 1) {
      emit({ type: "refinement_started", round, attempt, maxAttempts: refinementAttempts });
      const attemptStarted = Date.now();
      refinementCalls += 1;
      let patch: P | null = null;
      let violations: Violation[] = [];
      try {
        const response = await options.fetch(request, timeoutMs);
        if (response !== null) {
          patch = options.extractRefinement(response);
          if (patch !== null) violations = options.validateRefinement(patch);
        }
      } catch {
        patch = null;
      }
      const elapsedMs = Date.now() - attemptStarted;
      if (patch === null) {
        emit({
          type: "refinement_finished", round, attempt, elapsedMs,
          outcome: "unusable", violations: [],
        });
        continue;
      }
      if (violations.length > 0) {
        emit({
          type: "refinement_finished", round, attempt, elapsedMs,
          outcome: "rejected", violations,
        });
        continue;
      }
      const candidate = options.applyRefinement(current, patch);
      if (candidate === null) {
        emit({
          type: "refinement_finished", round, attempt, elapsedMs,
          outcome: "rejected",
          violations: [{ code: "patch_rejected", message: "The patch could not be applied to the current value" }],
        });
        continue;
      }
      const issues = await options.qualityCheck(candidate);
      emit({ type: "quality_checked", round, issues });
      current = candidate;
      currentIssues = issues;
      if (errorCount(issues) < errorCount(bestIssues)) {
        best = candidate;
        bestIssues = issues;
        emit({
          type: "refinement_finished", round, attempt, elapsedMs,
          outcome: "accepted", violations: [],
        });
        break;
      }
      emit({
        type: "refinement_finished", round, attempt, elapsedMs,
        outcome: "rejected", violations: [],
      });
    }
    if (errorCount(bestIssues) === 0) break;
  }

  const accepted = errorCount(bestIssues) === 0;
  emit({ type: "refinement_done", rounds, accepted });
  return {
    value: best,
    rounds,
    issues: bestIssues,
    accepted,
    generationTelemetry: task.telemetry,
    refinementCalls,
  };
}
