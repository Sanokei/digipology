# Crafted playable pieces

The user reported that the actual game still looked like primitives. This
increment replaces the existing piece presentation in both renderer adapters,
without changing published game rules or canonical state.

## Design and review scope

Use shared raster faces, rounded card stock, visible paper edges and patterned
backs for cards and decks. Standard playing-card identities must come from the
explicit authored deck convention and matching label. Keep custom names/colors;
never infer a standard identity from an arbitrary ID. Concealed artwork receives
only a generic back model. Standard D6 results use six pip faces with opposite
faces summing to seven; custom dice retain their actual authored result.

The hand and inspection dialog use the same painter as the physical pieces,
including mirrored illustrated court figures and the generic back. This avoids
different faces for the same card. All drawing stays in a browser-only module;
pure presentation models remain usable by Worker tests without DOM libraries.

An initial real browser review found allocated-texture stretching/cropping,
square ivory overlays on dice, excessive hover glow, a clipped phone deck and a
logical counter drawn through a die. Retain those intermediate captures. Paint
to the actual allocated texture size, overlay transparent pip ink, use a subtle
outer selection edge, frame spatial pieces on narrow screens, and omit counters
that have no physical transform. Existing authored spatial counters remain.

A second settled review caught an inside-out rounded body despite passing
gameplay checks: the initial mathematical triangle winding disagreed with
Babylon's default left-handed native builders. Compare against the installed
Core/Lite builders, retain outward normals, and use their clockwise front faces.
Transparent pip/chip faces use alpha testing; contact shadows keep soft blending.
Physical score chips carry the actual number on a painted rimmed face instead of
a floating rectangular label.

Automatic camera framing stops after deliberate camera/piece interaction;
Reset camera opts back in. Bounds derive only from objects the client may see.
Canonical transforms and existing grab/drop/flip actions remain unchanged.

## Acceptance

- Shared geometry/artwork and both interaction contracts: outward surfaces,
  pip counts, custom results, generic hidden faces, spatial-only bounds,
  resource disposal and unchanged gameplay action payloads.
- Actual settled cards, backs, decks and dice at desktop, tablet and 390 × 844;
  readable full card/Queen inspection at 390 × 480 with keyboard dismissal and
  restored focus. No clipped deck, hidden loading overlay or page overflow.
- Normal two-player draw/play/flip/reload and dice-to-winner flows, including
  presentation-private hands and concealed inspection, plus affected sound
  import/publication/recovery flows. No unrelated full-suite rerun is needed.
- Review original screenshots from the actual playable product. Test counts
  alone do not establish visual quality, fun or perceptual sound quality.

This is reusable built-in component artwork, not live prompt-generated custom
illustration. Per-game raster card artwork, model acquisition, music and genuine
one-prompt creative quality remain separate unfinished product work. No live
model/provider or public deployment is implied.
