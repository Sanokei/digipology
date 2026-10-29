# Creator flow review pack

Reviewed application source: **Sanokei/digipology@194dbac54647c4474d3ab11934843cbf30356fd0**.
This QA-only branch adds evidence without changing the reviewed source or main.
Pack path: `qa/194dbac-creator-handoff/` on `qa/creator-handoff-194dbac`.

The captures are unchanged PNG files from actual rendered Chromium tests. Exact dimensions, original capture names, file sizes and SHA-256 hashes are in [evidence.json](evidence.json). They can be retrieved individually through ordinary GitHub contents tools at this branch or its pack commit.

| Capture | What was exercised |
| --- | --- |
| [Creation recovery, desktop](screenshots/creation-recovery-desktop.png) | Accepted result preserved after real browser storage quota failure; retry and downloaded backup need no second provider request |
| [Private play, desktop](screenshots/private-play-desktop.png) | Real in-tab Lua gameplay to a winner, before publication |
| [Private play, narrow](screenshots/private-play-narrow.png) | 390px layout, authored description, selected local seat and controls |
| [Review, desktop](screenshots/review-desktop.png) | Keyboard-accessible suggestions for an unobserved win |
| [Restored review, narrow](screenshots/restored-review-narrow.png) | Review/description retained after saved-file import into private play |
| [Imported-note recovery, narrow](screenshots/imported-note-recovery-narrow.png) | Unfamiliar/prototype diagnostic code becomes a readable suggestion; technical internals stay outside the player flow |
| [Guest hand privacy](screenshots/guest-hand-privacy-desktop.png) | Other client's private hand remains absent from the guest's official-client view |
| [Table recovery](screenshots/table-recovery-desktop.png) | Renderer failure/reload recovery preserves the existing game and private hand |

[accepted-draft.editor.json](accepted-draft.editor.json) is the actual downloaded recovery file from the storage test. It preserves the authored tagline, original canonical bundle, seat ownership and optional version-bound generationReview metadata. The review hash matches the release manifest; review metadata is outside the immutable bundle and canonical state. It contains only deterministic fixture authoring, not credentials or a live generated game.

Validation at this source: 851 Bun tests/115 files; all workspace/scripts/E2E types; production web/site builds; renderer chunk/internal-link/frozen-replay checks; 14 full browser scenarios plus a final rebuilt four-scenario creation pass after imported-note and recovery-layout hardening. The source tests are [e2e/generation.e2e.ts](../../e2e/generation.e2e.ts) and [e2e/table.e2e.ts](../../e2e/table.e2e.ts). The local fixture is explicit in [scripts/e2e-generation-fixture.ts](../../scripts/e2e-generation-fixture.ts); real Lua and HTTP services run behind it.

The fixture deliberately requires a repair. Its long-game variant raises score target, limits and guide to produce an honest bounded-playtest warning. These checks demonstrate integration and recovery, not live original generation, strategic quality, balance or fun. Hand privacy is official-client presentation privacy, not cryptographic secrecy of shared deterministic state. No private authentication logs, tokens, real user records or provider credentials are included.

The UI preserves the authored name/description and informational review; publication remains explicit. Existing published releases and frozen replays are unchanged. Current limits remain: no live application provider credentials or raster/media orchestration; saved network rules still need publication; scheduled Actions execution and remote CI/deployment are unverified. Previews were loopback-only, so this source-pinned pack is the retrievable review artifact.
