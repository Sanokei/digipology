# digipology-ai

Shared, zero-runtime-dependency OpenAI-compatible transport, structured requests,
defensive extraction, usage metering, validator feedback and bounded repair.
Provider configuration is explicit; no local endpoint or model is selected.

## Configuration and profiles

`makeModelFetch` returns `null` when its endpoint is missing, blank or invalid,
including when a credential exists. Use HTTPS for remote endpoints; explicit
HTTP loopback endpoints support local development. Credentialed URLs, query
strings and fragments are rejected. Redirects fail rather than forwarding a
provider credential. Pass keys from server configuration only.

```ts
import { buildRequest, makeModelFetch, runStructuredTask } from "digipology-ai";

const profile = "openai";
const modelFetch = makeModelFetch({
  baseUrl: env.AI_BASE_URL,
  apiKey: env.AI_API_KEY,
  profile,
});
if (!modelFetch || !env.AI_MODEL.trim()) return unavailable();
const request = buildRequest({
  model: env.AI_MODEL,
  profile,
  jsonObject: true,
  messages: [{ role: "user", content: "Return the requested JSON object." }],
  maxTokens: 24_000,
});
const outcome = await runStructuredTask({ fetch: modelFetch, request, extract, validate });
```

- `openai-compatible` preserves ordinary `max_tokens` and temperature, with no
  provider-specific prompting or JSON-mode assumption.
- `openai` uses `max_completion_tokens`, omits temperature and Qwen-only fields,
  and enables JSON-object mode only when the builder explicitly requests it.
  This supports reasoning-model parameter conventions; the configured model
  still must support Chat Completions and the requested features.
- `qwen-local` explicitly enables Qwen suppression with `enable_thinking=false`
  and a final `/no_think` user suffix, including appended validation feedback.

Profiles never choose a model, endpoint or credential. `LOCAL_MODEL_BASE_URL`
is an optional explicit loopback example. The old `DEFAULT_MODEL_BASE_URL` and
`DEFAULT_MODEL_ID` exports remain empty compatibility values.

Synchronous generation defaults to 180 seconds and repair to 120 seconds per
attempt. The HTTP transport caps any timeout at 300 seconds. The app's separate
output budgets and server setup are documented in
[the provider runbook](../../docs/runbooks/ai-provider.md).

## Usage metering

Usage is metered in requests, not dollars: `responseRequests(response)`
returns 0 for a null response and 1 otherwise (for the daily
abuse-protection cap).

## Structured output

Build requests with `buildRequest` or the exported wire interfaces. Structured
results can use raw JSON or an explicit forced function tool. `buildRequest` creates a strict
object schema with `additionalProperties: false`; callers provide every
required field and put any enums in their property schemas. Every extracted
value still passes through a feature-specific normalizer before it is trusted.

The package intentionally contains no endpoint, database, per-user cap,
global reserve/reconcile ledger, feature schema, SDK, or retry backoff.
