# Artwork recovery and CI browser acceptance

Source: af009d58a820fb64d40bc6edbb6946e644feedab. Hosted run40943958148 passed940 unit tests and24/33 browser cases; nine failures remain. Its exact artifact zip is retained privately (sha25648919c28297290cd9b8a05f1bf66eb7d0492d0b4a6d8f434ff4961e7ff4e2bfa).

Observed: the new game artwork dialog supersedes old direct upload selectors. A corrupted cover with a pending generated-image job is silently replaced by the auto-resume request on reload. The new nested replacement drops editable-backup/quota feedback and removal. Four later auth requests return429 because separate test users share one IP cap. Editor/private reload renderer cases require foreground and fresh rendered-state review; current evidence does not establish data loss.

Acceptance:
1. Preserve damaged saved cover as an explicit, publication-blocking repair task across reload. Show a legible explanation and replace/remove choices in the game artwork workflow; resume generated repair only after a deliberate retry.
2. Normal Cover > Replace image supports credits, failed decode keeping prior pixels, quota feedback, exact editable backup, retry, removal and focus return on desktop390px/short. Saving art retains the running hand/scores and canonical state.
3. Distinct browser cases simulate distinct Cloudflare client IPs through the existing local-worker request header. Keep real production rate limits; one case exceeding the same-IP cap must still receive429. Do not use rate bypass endpoints or new credentials.
4. Exercise the nine previously failed browser cases with actual rendered readiness; preserve identity/private hands after foreground reload and stale rule review after editor handoff. Investigate any repeat renderer failure before declaring a pass.
5. Run affected unit/types/build/frozen checks, merge checked source using existing authorization, observe exact-source hosted CI and pin current source/failure/recovery images in GitHub. Fixtures are technical pipeline evidence, not generated artwork quality or Merlin generation.
