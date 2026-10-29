# Application model provider

No live application model or credential is configured in this cloud checkout.
The existing ChatGPT CLI login is separate from an application API credential.
An environment draft is saved configuration; its network rules require
publication before they apply. Do not retry a known unchanged CONNECT denial.

## Explicit configuration

Set these server-side values in the target environment. Local values belong in
the existing ignored `apps/worker/.dev.vars`; preserve its current contents.
Production credentials belong in Wrangler secrets, never committed `vars` or
browser code. An account-enabled model must be selected and verified by its
owner; no model quality or availability is inferred from these examples.

| Setting | Purpose |
| --- | --- |
| `AI_PROVIDER_PROFILE` | `openai-compatible` (default), `openai`, or explicit `qwen-local` |
| `AI_BASE_URL` | Exact base ending before `/chat/completions`; blank is unconfigured |
| `AI_MODEL` | Provider model ID enabled for the account; blank is unconfigured |
| `AI_API_KEY` | Server-only provider credential; required by the OpenAI profile |
| `AI_QUALITY_BASE_URL` | Actual Bun quality service; local setup uses `http://127.0.0.1:8798` |
| `AI_QUALITY_TOKEN` | Matching credential for a hosted HTTPS quality service |

For OpenAI, the base is `https://api.openai.com/v1` and the profile is `openai`.
Use a model supporting Chat Completions and JSON-object mode. Remote endpoints
require HTTPS. Local compatible/Qwen services can explicitly use HTTP at
`127.0.0.1`, `localhost` or `[::1]`; Workers deployed remotely cannot reach a
developer's loopback service. URLs with embedded credentials, query strings or
fragments are unsupported. Redirects are rejected to preserve credential scope.
Azure-specific routes/queries and Responses API calls are not implemented.

The `openai` profile uses `max_completion_tokens`, omits temperature and
Qwen-specific fields, and requests a JSON object for generation/repair.
`openai-compatible` uses `max_tokens` and temperature without assuming JSON mode.
Only `qwen-local` adds `/no_think` and `enable_thinking=false`; it also covers
appended format-repair feedback. No machine-specific model path remains.

## Bounded output and deadlines

| Optional setting | Default | Allowed range |
| --- | --- | --- |
| `AI_MAX_OUTPUT_TOKENS` | 24000 | 1024–65536 |
| `AI_REPAIR_MAX_OUTPUT_TOKENS` | 8000 | 512–32768 |
| `AI_TIMEOUT_MS` | 180000 | 5000–300000 |
| `AI_REPAIR_TIMEOUT_MS` | 120000 | 5000–300000 |

Budgets are separate because a complete authored game needs more output than a
focused file patch. They bound output; they do not guarantee that a particular
model can finish a game. For reasoning models, the completion-token budget also
includes reasoning tokens. Invalid profile/budget settings return the existing
recoverable configuration error before provider calls or usage accounting.

Creation still uses synchronous requests with up to three structural attempts
and two quality-repair rounds. Persistent background jobs, streamed progress,
request cancellation and ambiguous network-result recovery need further work.
The daily request cap is abuse protection, not a dollar budget or billing meter.

## Verification and remaining acceptance

Official OpenAI sources consulted:

- https://github.com/openai/openai-node#readme — Responses is primary; Chat
  Completions remains supported.
- https://github.com/openai/openai-node/blob/master/src/resources/chat/completions/completions.ts
  — `max_completion_tokens` includes reasoning and visible output; `max_tokens`
  is deprecated and incompatible with o-series models; JSON-object mode is an
  explicit response format.

Local tests verify actual loopback HTTP request bytes, server-side authorization,
profile isolation, missing/invalid settings, timeouts, redirects and the real
creation→Lua-quality→repair path with independent budgets. Deterministic
provider fixtures establish integration behavior only.

Before claiming live generation, configure an authorized endpoint/model and
credential, publish needed network access for that actual host, and run original
card/dice/resource/choice prompts through creation, recorded action histories,
private play and independent multiplayer completion. Keep failures and failed
repairs. Neither canned provider responses nor built-in game authoring is a live
creative result. Raster covers and integrated model/audio/music providers remain
separate unfinished acceptance requirements.
