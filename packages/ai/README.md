# digipology-ai

Shared, zero-runtime-dependency DeepSeek harness for Digipology. It provides
the OpenAI-compatible transport, forced-function-tool request shape, defensive
payload extraction, conservative usage pricing, and validator-feedback retry
loop used by AI features in Workers, Bun, and browsers.

## Keyless behavior

`makeDeepseekFetch` returns `null` when no API key is configured. Consumers
branch once at construction time and select their deterministic fallback:

```ts
import { makeDeepseekFetch, runStructuredTask } from "digipology-ai";

const deepseekFetch = makeDeepseekFetch({ apiKey: env.DEEPSEEK_API_KEY });
if (deepseekFetch === null) return deterministicFallback();

const outcome = await runStructuredTask({
  fetch: deepseekFetch,
  request,
  extract,
  validate,
});
return outcome.result ?? deterministicFallback();
```

The API key belongs in the `DEEPSEEK_API_KEY` Worker secret and must never be
shipped to a client. Call sites may replace `DEFAULT_DEEPSEEK_MODEL` with their
configured `DEEPSEEK_MODEL` value.

## Structured output

Build requests with `buildRequest` or the exported wire interfaces. Structured
results always use a forced function tool. `buildRequest` creates a strict
object schema with `additionalProperties: false`; callers provide every
required field and put any enums in their property schemas. Every extracted
value still passes through a feature-specific normalizer before it is trusted.

The package intentionally contains no endpoint, database, per-user cap,
global reserve/reconcile ledger, feature schema, SDK, or retry backoff.
