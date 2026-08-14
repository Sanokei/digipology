---
title: "AI features"
description: "How prompt-based game drafts, editor-assisted changes, cover options, server configuration, and usage limits work."
---

# Digipology AI features

Digipology can turn a written game idea into a reviewable release draft, propose changes to a draft, and use model-selected directions for cover art. AI output is always a draft or a choice: it does not publish a game by itself.

## Create a game from a prompt

On the create page, describe the game you want and choose **Create draft with AI**. The server asks its configured model for a structured draft, assembles the canonical snapshot and integrity fields, and runs the normal bundle validation. A successful result fills the standard upload form, where you can inspect the title, player range, JSON, and validation report before publishing.

AI creation requires an account. Publishing the generated draft is a separate action and uses the same validated upload path as a manually authored bundle.

## Iterate inside the editor

The desktop editor's **AI Assist** panel has separate prompt boxes for creating a new game and editing the open draft. A proposed edit is not applied immediately: the editor first summarizes entity-count changes, changed script line counts, and changed settings. Choose **Apply as one edit** to add the proposal to the draft as a single undoable edit, or cancel it.

For an unpublished local draft, the editor sends the current bundle as context for a new draft request. For a published game that you own, the server loads its latest release before generating the replacement draft. Continue with the [creator guide](./creator-guide.md) to playtest and publish reviewed changes.

## Generate cover options

In **My games**, an owner can ask for four cover options. When model assistance succeeds, the model selects constrained cover specifications and Digipology's own renderer produces the SVG previews. Pick one to rasterize it in the browser and upload it as the game's cover.

Cover creation remains available without the model: if AI is not configured, the daily AI budget has been reached, or model output cannot be used, the server returns four deterministic procedural options and the picker labels them as generated with the deterministic cover system.

## Availability and limits

The browser never asks you for a model provider API key. Prompt-based creation and editing run through the server's own DeepSeek configuration.

If that configuration is missing, game creation and edit requests return `ai_unconfigured` with **“AI creation isn't set up on this server yet”**. Prompt-based drafting is unavailable on that server; the manual editor remains available, and cover generation uses its procedural fallback.

AI game draft requests also have a per-user daily spend cap configured by the server through `AI_DAILY_USD_CAP`, plus request rate limiting. Operations can change those limits, so the interface does not promise a fixed number of drafts. When the daily cap is reached, the request returns `ai_daily_cap` and explains that today's AI creation limit resets at UTC midnight. When requests arrive too quickly, it returns `rate_limited` with **“Too many AI draft requests; try again later”**.
