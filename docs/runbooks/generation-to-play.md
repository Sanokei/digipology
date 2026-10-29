# Generation to playable output

The next acceptance target is a real prompt flowing through the creation API,
quality checks and repairs into a playable, unpublished browser draft, with an
explicit action to publish and invite other players. A JSON upload form is an
advanced authoring option, not the main result of successful generation.

## Current prerequisites

The 2026-10-29 audit found no configured AI_BASE_URL, AI_MODEL or AI_API_KEY in
the local private configuration, and no OPENAI_API_KEY in the process. No live
model request was attempted with invented credentials. Configure a supported
server-side model endpoint and model, and its credential if required, before
claiming live generation. The environment network draft still requires
publication; prior CONNECT denials are not bypassed or repeatedly retried.

The official OpenAI Node client documentation was consulted at
https://github.com/openai/openai-node#readme . It identifies Responses as its
primary API while continuing to document Chat Completions. The current app uses
an OpenAI-compatible Chat Completions transport; a ChatGPT CLI login is not an
application provider credential.

## Acceptance plan

1. Match new-session player/seat setup between actual rooms, the quality
   harness and local playtesting. Game-start scripts must see the real roster;
   a quality check must not accept a lifecycle the live room cannot reproduce.
2. Open accepted output directly as a saved, unpublished browser playtest.
   Support every local seat, legal actions, rules, feedback and restarting the
   playtest without mutating the authored release. Keep loading, failure and
   retry accessible, including when browser storage is unavailable.
3. Keep publication explicit. A published result can be hosted and joined by
   another independent client through the existing immutable-release pipeline.
4. Run the actual creation API, Lua quality/repair service, browser gameplay and
   publication flow against a clearly labelled deterministic provider fixture.
   This demonstrates integration behavior, not live creative quality.
5. Once an authorized live provider is configured, repeat with original prompts
   combining cards, dice, resources, player choices and victory. Record failures
   and actual action histories; do not replace this with a built-in game.

The initial audit also found machine-specific model defaults, a 3,000-token
budget and provider-specific prompting. The explicit profiles and separate
generation/repair budgets are now described in [provider setup](ai-provider.md).
Creation still needs background jobs and durable progress/recovery. Media
admission/mastering has CLI harnesses; orchestration and editor review still
need integration with actual provider access.

## Implemented private play path

Successful creation opens `/playtest/:draftId` directly. The authored draft is
stored using the normal editor draft format and remains editable. Local seats
can be switched without changing the authored bundle; each action uses the
selected actor. Reopening or restarting resets the local run, as stated in the
UI. Runtime logs, rules, prompts, dice, cards, game buttons and sound feedback
remain available. Pending asynchronous setup cannot reopen a stopped playtest.

Publish & invite is an explicit action. A content-derived publication slug lets
a retry recover a committed publication after a lost reply or room-open failure
instead of creating another copy. The server's normal validation, unlisted
publication and private-room paths remain in force; local run state is never
uploaded as the authored starting state.

Uploaded rooms now put their current roster in the sequence-zero snapshot
before game-start scripts run. Membership is reread inside the startup
transaction after release loading, covering concurrent arrivals. Existing
started rooms, published release artifacts and frozen replays are not rewritten.

Browser acceptance uses a deterministic provider fixture on loopback and a real
Bun Lua quality service. The fixture deliberately emits a runtime error, then a
repair patch. This exercises the actual creation API and repair meter before
private play, explicit publication and a second client's complete game. It is
not a live provider or evidence of original strategy-game generation.

## Bounded choice and lifecycle probes

The quality service now tests the real minimum and maximum rosters, plus a host
starting alone followed by normal player-joined and seat-assigned actions. It
does not silently reduce an eight-player minimum to four players. Each setup
runs with first and last choices, in a fresh Lua runtime and the release's own
RNG seed. Prompt responses use the actual prompted player, including prompts
outside the current turn; number responses obey the kernel's exact step grid.

Exploration includes dice, enabled buttons, drawing cards to the actor's hand
(owned directly by player ID or through their currently assigned seat),
choice/number/confirmation prompts, and scheduled callbacks. Guards can reject
an attempted action without becoming script errors. A changing die face alone
does not establish rule progress. Runtime failures include the scenario,
sequence and triggering action in the issue sent to the repair loop.

`POST /check` retains the existing `issues` response and also returns a versioned
`simulation` report: manifest hash, setup and choice policy, initial state hash,
ordered actions, rejections, events, per-action state hashes and stopping reason.
The report can be replayed from the corresponding seeded release; a regression
replays recorded actions and checks every hash. Response caching is disabled.
Normal hosted quality-service authentication is still required.

The existing `simulateRolls` setting is retained as an exploration budget:
four action attempts per unit, capped at 96 gameplay attempts per session.
Lifecycle setup is separate and bounded by the supported 64-player limit.
Up to six sessions run, with at most 256 candidate player actions considered in
one step; a candidate limit produces an explicit coverage warning. Timers use
virtual deterministic time rather than waiting for real-time delays.

These probes sample the two ends of a choice list, not every branch or strategy.
They do not explore drag/zone placement, arbitrary resource trades, multiple RNG
seeds, balance, pacing or fun. Unobserved wins and stalled/limited exploration
remain warnings requiring review; runtime and lifecycle errors prevent draft
acceptance until repaired. Original live strategy prompts and human playtests
remain necessary acceptance work.
