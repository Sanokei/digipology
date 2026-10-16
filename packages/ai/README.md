# digipology-ai

Shared, zero-runtime-dependency harness for a LOCAL Qwen3-0.6B model served
over an OpenAI-compatible endpoint. It provides the transport,
forced-function-tool request shape, defensive payload extraction,
request-count metering, and validator-feedback retry loop used by AI
features in Workers, Bun, and browsers.

## Keyless behavior

`makeModelFetch` returns `ModelFetch | null`. It returns `null` ONLY when
`baseUrl` is explicitly empty AND no `apiKey` is given (deliberately
unconfigured — callers serve a 503 `ai_unconfigured`). An undefined `baseUrl`
falls back to `DEFAULT_MODEL_BASE_URL` (`http://127.0.0.1:8081/v1`); no API
key is needed for a local endpoint. Consumers branch once at construction
time and select their deterministic fallback:

```ts
import { makeModelFetch, runStructuredTask } from "digipology-ai";

const modelFetch = makeModelFetch({ apiKey: env.AI_API_KEY });
if (modelFetch === null) return deterministicFallback();

const outcome = await runStructuredTask({
  fetch: modelFetch,
  request,
  extract,
  validate,
});
return outcome.result ?? deterministicFallback();
```

`AI_API_KEY` is an optional Worker secret, needed only if the endpoint
requires auth, and must never be shipped to a client. Call sites may replace
`DEFAULT_MODEL_ID` (the local Qwen3-0.6B model id/path) with their configured
`AI_MODEL` value.

## Usage metering

Usage is metered in requests, not dollars: `responseRequests(response)`
returns 0 for a null response and 1 otherwise (for the daily
abuse-protection cap).

## Structured output

Build requests with `buildRequest` or the exported wire interfaces. Structured
results always use a forced function tool. `buildRequest` creates a strict
object schema with `additionalProperties: false`; callers provide every
required field and put any enums in their property schemas. Every extracted
value still passes through a feature-specific normalizer before it is trusted.

The package intentionally contains no endpoint, database, per-user cap,
global reserve/reconcile ledger, feature schema, SDK, or retry backoff.
