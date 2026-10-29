---
title: "AI features"
description: "How prompt-based game drafts, editor-assisted changes, cover options, server configuration, and usage limits work."
---

# Digipology AI features

Digipology can turn a written game idea into a reviewable release draft, propose changes to a draft, and use model-selected directions for cover art. AI output is always a draft or a choice: it does not publish a game by itself.

## Create a game from a prompt

On the create page, describe the game you want and choose **Create draft with AI**. The server asks its configured model for a structured draft, assembles the canonical snapshot and integrity fields, and runs the normal bundle validation. A successful result fills the standard upload form, where you can inspect the title, player range, JSON, and validation report before publishing.

AI creation requires an account. Publishing the generated draft is a separate action and uses the same validated upload path as a manually authored bundle.

Before accepting a generated draft, the server sends it to the playtest
harness. The harness checks Lua, bindings, references and a simulated dice
playthrough. Broken drafts receive up to two bounded repair rounds through the
configured model, with those calls included in the request cap. The response
includes the playability result and any remaining warnings. If playtesting is
unavailable or errors remain, the server does not present the draft as accepted.

This gate catches concrete rule/runtime errors. It does not prove that every
kind of generated game is balanced, fun or ready for release. Full generated
strategy-game playthroughs, online media integration and generated raster
packaging remain acceptance milestones in the product backlog.

## Iterate inside the editor

The desktop editor's **AI Assist** panel has separate prompt boxes for creating a new game and editing the open draft. A proposed edit is not applied immediately: the editor first summarizes entity-count changes, changed script line counts, and changed settings. Choose **Apply as one edit** to add the proposal to the draft as a single undoable edit, or cancel it.

For an unpublished local draft, the editor sends the current bundle as context for a new draft request. For a published game that you own, the server loads its latest release before generating the replacement draft. Continue with the [creator guide](./creator-guide.md) to playtest and publish reviewed changes.

## Generate cover options

In **My games**, an owner can ask for four cover options. When model assistance succeeds, the model selects constrained cover specifications and Digipology's own renderer produces the SVG previews. Pick one to rasterize it in the browser and upload it as the game's cover.

Cover creation remains available without the model: if AI is not configured, the daily AI budget has been reached, or model output cannot be used, the server returns four deterministic procedural options and the picker labels them as generated with the deterministic cover system.

## Availability and limits

The browser never asks you for a model provider API key. Prompt-based creation and editing run through the server's own Qwen 0.6B configuration (local model, no API key needed by default).

The server also requires `AI_QUALITY_BASE_URL` for its Bun playtest harness.
Locally, start `bun run dev:quality` and point it to the loopback service on
port 8798. Production must use an authenticated HTTPS harness and a matching
`AI_QUALITY_TOKEN`; the Wasmoon runtime runs in that service rather than inside
the Cloudflare request runtime. Model transport and model selection remain
server configuration. A small local model is not evidence that complex
one-prompt creation works well.

If that configuration is missing, game creation and edit requests return `ai_unconfigured` with **“AI creation isn't set up on this server yet”**. Prompt-based drafting is unavailable on that server; the manual editor remains available, and cover generation uses its procedural fallback.

AI game draft requests also have a per-user daily request cap configured by the server through `AI_DAILY_REQUEST_CAP`, plus request rate limiting. Operations can change those limits, so the interface does not promise a fixed number of drafts. When the daily cap is reached, the request returns `ai_daily_cap` and explains that today's AI creation limit resets at UTC midnight. When requests arrive too quickly, it returns `rate_limited` with **“Too many AI draft requests; try again later”**.
