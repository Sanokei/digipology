# Product improvement loop

The target is a real one-prompt creator: a person describes a board game with
the depth of a strategy game combining cards and dice, and receives a coherent,
playable result. Rules, player choices, resources, trading, turn flow, naming,
raster packaging, model assets, sound effects and music all contribute to that
result. New showcase games do not substitute for improving the creation flow.

`.github/workflows/product-loop.yml` runs one bounded iteration every six hours
or on manual dispatch. It reads the first unfinished item in
`.github/product-loop/backlog.json`, uses Codex to implement a focused increment,
and independently runs type checks, the full Bun suite, both web builds,
renderer bundle isolation and browser playthroughs. It leaves frozen replay
fixtures and its own automation baseline unchanged. Necessary dependency changes
are installed and locked before validation, then checked with a frozen install.

After those checks pass, the workflow pushes a branch, opens a PR and explicitly
dispatches CI on that commit. This explicit dispatch matters: pushes made with
GitHub's built-in workflow token do not automatically trigger another PR
workflow. It waits for that CI run to succeed and merges the exact checked head
with squash merge. Repository rules remain in force. There are no force
pushes, admin merges or disabled tests. An open product-loop PR pauses new
iterations until it is resolved. The loop stops when its backlog is complete.

## Activation and controls

The workflow must be on the default branch. It uses the existing repository
`OPENAI_API_KEY` Actions secret through the official Codex action. If that
secret is absent, add it securely in GitHub repository settings; do not paste
it into chat, a workflow or an issue. The running cloud machine's ChatGPT login
is not a portable credential for GitHub-hosted jobs.

GitHub Actions needs permission to create PRs, and the repository must allow
the configured squash merge. Required reviews and other branch rules can leave
a verified PR awaiting an operator. Workflow logs and the job summary identify
that state. Do not bypass repository rules to keep the loop moving.

Use the workflow's manual dispatch for an immediate cycle. Disable its schedule
in GitHub Actions to pause recurring work. Edit the checked-in backlog to change
priorities. One run is capped at 110 minutes and one active iteration; it is
not an unlimited background session.

Browser traces, screenshots and the iteration report are retained as run
artifacts for 14 days. A milestone is marked complete only when its acceptance
criteria were verified. Passing code checks can produce a useful partial
increment while a milestone remains unfinished.

## Acceptance evidence

`bun run test:e2e` starts an isolated local Worker with a fresh database and
temporary development credentials. The browser suite hosts through the UI,
joins a second independent browser context, plays Dice Dash to a winner,
checks turn enforcement and score agreement, observes actual Web Audio source
playback, reloads the completed game, and verifies mute persistence. It also
draws and inspects cards, checks separate hands, exercises mobile controls and
verifies invalid-invite recovery. Screenshots and traces go under ignored
`test-results/` and `playwright-report/` directories.

Install the browser with `bunx --no-install playwright install --with-deps
chromium`. A system Chromium can instead be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; the onboarding image uses
`/usr/bin/chromium`. FFmpeg and ffprobe are required by the media processing
tests. Use `E2E_SKIP_BUILD=1` only after building the current web source.

These checks demonstrate real runtime behavior, not fun or creative quality.
For generated strategy games, record human playtest observations about:

- Whether a new player understands their goal and next legal action.
- Whether choices have consequences rather than a single obvious move.
- Downtime between turns, dead ends, runaway leaders and reachable victory.
- Visual readability at table and thumbnail sizes.
- Repetitive or intrusive sound, clear feedback, usable volume controls and
  seamless music transitions.

Turn observations into specific backlog criteria and regression tests where
possible. Live generation, external asset import, generated raster covers and
human fun evaluations remain separate evidence requirements; the demo
playthroughs do not establish one-shot greatness.
