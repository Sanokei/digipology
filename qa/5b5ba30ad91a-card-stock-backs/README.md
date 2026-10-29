# Card stock, game-specific back assets and safe phone menus

Application source: `5b5ba30ad91a3a17bc18843ec756ffb7ffff1288`. QA-only commit directly parents this source. Source diff starts at `fbc1d4bb8928bd7513af8d82dc8dcdddc2c19fdc`. Per-file source scopes are in manifest.json.

## What this checkpoint establishes

- Shared 3 mm / 63 mm paper-corner profile, a small bevel and straight stock walls. Single cards, deck tops, DOM hand faces and inspectors share the mask. Stack counts do not change the printed back.
- A game's explicitly authored raster back survives normal editor input, invalid-image recovery, private play, publication, another player's concealed inspection, exact image download, reload and editable backup. Two actual published fixture games retain different image hashes; the first release stays exact. Presentation does not alter the canonical initial snapshot or rules.
- A bounded phone dock keeps Players, card actions and an owned hand in separate visible bounds. Finished Dice Dash hides Roll and offers Play again. A controlled new-table failure preserves the old winner and retries to a fresh private table using the same release.
- Native Chromium touch exposed an accidental release click on a newly opened Play menu. Retained trusted-event/action observations prove it sent grab/drop before a choice. A fresh-pointerdown guard now keeps the hand private on release, then allows a deliberate tap. Fresh mouse and keyboard activation also pass.

## Exact checks and scopes

`validation/checks`: source `2c8aa9fe5eae0a9ef027d872531693d5aabc1ee9`, 141 focused tests pass, affected web build/types/chunks/frozen checks pass; first four-case browser run has TWO failures and TWO passes. Failures were the new narrow dock's displaced/non-hit menu and an intentionally open audio popover covering a later resized retry click. They are not a passing receipt.

`validation/checks-fixed`: source `40444523553057798243a2cafbcaf590d627c76b`, corrected web build and E2E types pass; two corrected browser cases pass with child exit0. Missing-art retry and original private-hand/reload cases passed at `2c8aa9fe5eae0a9ef027d872531693d5aabc1ee9` and are separately scoped. No unrelated full-suite rerun or live-provider inference is implied.

`validation/checks-touch`: source `31762220ecfdbb058e40d79bc029901b529ef04b`, affected build/types/chunks/frozen checks and both new real-touch/mouse/keyboard browser cases pass with child exit0. The separate native touch command at `31762220ecfdbb058e40d79bc029901b529ef04b` also exits0. `validation/checks-hand-gesture` at current `5b5ba30ad91a3a17bc18843ec756ffb7ffff1288` passes both extended cases again, including the first subsequent hand tap and keyboard activation after a long press; build/types/chunks/frozen checks all exit0. WebGL/Core and actual native Lite/SwiftShader stock/dice/winner originals in `visual/` were captured at `40444523553057798243a2cafbcaf590d627c76b`; later application changes guard DOM menu activation and reset hand gesture suppression; actual touch originals and browser checks are separately pinned. Native Lite exits0. Chromium software rendering and touch emulation do not establish hardware performance.

## Artwork quality remains rejected

The existing cover/poster pictures used here are local host-authored test assets. Repeating miniature cards/coins, a one-way cover composition and a tiny footer title make a poor deck back. These images prove image handling, not polished artwork or automatic game-specific art. The human explicitly requires the created game to choose a coherent art direction and create its own cover, card fronts and deck backs. That generation seam remains unfinished. No SVG/procedural fallback, borrowed cover or fixture counts as bespoke generated art.

The next real end-to-end target is the user's Merlin Economics v0.1.27b rulebook at SidewaysTurtle/MerlinEconomics commit `8bed07f5bfed67b89cf52b5c6ce3baa7bdd97260`. Full-source intake is next because 65,833 characters cannot fit the old 8,000-character prompt / 64 KiB request. Its seven linked Google Sheets remain required sources: a normal Royal Decrees request was denied by the environment with CONNECT403, which does not mean those sheets are empty or private.

## Original frames to review first

- `visual/stock-front-corners-closeup.png` and `visual/stock-back-corners-closeup.png`: shared physical corners/stock at404.
- `visual/cards-back-narrow.png`: the retained below-target sample artwork at404.
- `visual/touch317/touch-dock-players-hand-open.png` and `visual/touch317/touch-hand-menu-hit.png`: nonoverlapping phone panels and deliberate menu hit at317.
- `visual/lite-winner-narrow.png`: actual Lite winner/Play again at404.
- `browser/checks-fixed/cardBacks.e2e.ts-different-12960-guest-inspection-and-backup/different-themed-back-desktop.png` and `guest-themed-inspection-390.png`: two separately published fixture back images and concealed guest inspection at404.
- `browser/checks-hand-gesture/object-context-menu.e2e.ts-a240c-vate-until-a-fresh-menu-tap/long-press-release-keeps-hand.png`: current5b native release keeps both cards private before a choice.

## Limits retained

No genuine app model generation, full Merlin implementation, balance/fun or perceptual audio acceptance is claimed. The exact original/mastered sounds and portable listening page remain in the independently reviewed [prior sound pack](https://github.com/Sanokei/digipology/tree/a3f4935f88a87f57f0286b36a9c2cf9185dd5c39/qa/fbc1d4bb8928-crafted-table-sounds). Official-client privacy is presentation privacy, not cryptographic secrecy. Local preview has no supported public URL. Saved cloud configuration is an unpublished draft; live provider credentials, production migration0008/deployment and scheduled Actions verification remain pending. The older two-case tool-exit anomaly remains historical in earlier receipts.

Raw auth logs, session storage dumps and traces are excluded. Images are original captures. `manifest.json` hashes every other pack file; publication verifies those hashes from Git blobs.
