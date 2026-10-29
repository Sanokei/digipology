# Public game entry at narrow widths

Base source: `fd26a3e9993a556232be3fb33af54f5bbaa07a53`.

The new `e2e/game-detail.e2e.ts` regression publishes the existing saved raster
fixture through the local game/cover APIs and opens its real public detail page
in a fresh anonymous browser. At 390×844, the settled title starts at y=921.4
(110px high), and Play or host at y=1263.4 (48px high). The expected first-screen
assertion fails. The screenshot has no horizontal overflow; the portrait and
credits simply occupy the entire first screen. This is fixture-based UI evidence,
not model generation or a newly authored game.

The causes are concrete: `GameDetailPage.tsx` renders artwork before its copy;
`styles.css` changes the two-column card to one column at 860px; `artwork.css`
retains the cover's 2:3 aspect ratio. The current primary link also navigates to
`/`, losing the selected game. `HostDialog.tsx` already handles private hosting,
guest naming, keyboard focus, invites and table navigation, but its options come
only from the public catalog, which excludes unlisted games.

## Bounded change

1. Put the game identity, player range and primary action first in reading and
   keyboard order. Keep the desktop artwork-left/copy-right arrangement with
   named CSS grid areas. Move descriptive text and secondary statistics after
   the action, allow full long titles to wrap, and reduce spacing at short height.
2. Bound the mobile artwork preview by viewport height and use `object-fit:
   contain`. Keep the stored asset, versioned URL and attribution unchanged.
   Add an explicit full-image link; preserve both existing download actions.
3. Open the existing host dialog from the detail page. Seed it with the already
   loaded game so direct unlisted entry and a failed catalog fetch still retain
   the selected game. Keep server authorization and normal homepage hosting.

## Acceptance and evidence

Only the new detail-page scenarios and existing host-dialog scenarios need browser
execution. Check web/E2E types, production build, chunk boundaries and frozen
fixtures; do not repeat unrelated full suites for this presentation change.

Check actual public and unlisted entry at desktop, 390×844 and 390×480; long titles
with a long unbroken word; absent artwork; a failed image followed by retry; and
a landscape response fixture (layout stress only—the upload API admits portraits).
Measure full heading/action bounds and overflow. Exercise keyboard focus/Escape,
full-image access, raw/credit downloads, selected-game hosting and a second guest
joining the actual invite with the renderer ready. Verify the original image bytes,
credit metadata and version remain exact. Save before/after viewport captures
with their precise source refs and runner exit status.

The first five-case focused run after correcting the test title to the actual
80-character API limit passed. A further short-height entry check exposed an
integration issue: the reusable host dialog's z-index 20 was below the detail
header's z-index 40. At 390×480 its Close button (y=40–74) was covered by the
header, and inherited 50px radio inputs pushed Create table to y=491. The bounded
host-dialog styles raise it above the header, size radio controls correctly and
provide a compact, scrollable short-height form. A third detail scenario checks
hit testing, fully visible Close/Create actions, keyboard wrap, resize, and
separate sign-in overlay dismissal without losing the selected game.

The final affected run passes six browser scenarios (three detail entry scenarios
and three existing host-dialog scenarios), with no skips, flaky tests or reporter
errors, and captured child exit 0. Web build/types, E2E types, the host gating unit
test, isolated renderer chunks and the frozen-fixture guard pass. No unrelated
full unit/browser cycle was run for this increment.

The settled 390×844 title is now at y=205.7–272.9 and Play or host at y=324.9–372.9.
At 390×480 the accepted 80-character title is fully visible, with the action at
y=380.7–428.7. The raw image download remains byte-identical to the saved fixture
(`sha256:7e2c3f7ec1366c6e89f4d035c33604f3939b35d3aad66ece4f2f3ccb30522bd0`),
with cover version 1 and matching credits after download and hosting. A public
page, direct unlisted page, controlled catalog failure, actual table entry and
second guest invite join all use the selected release. The landscape case is a
response fixture only; no landscape upload or live creative generation is claimed.
