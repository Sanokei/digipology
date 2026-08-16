---
title: "Playing Digipology"
description: "Quick Play, public and private rooms, guest access, invitations, and reconnect behavior."
---

# Playing Digipology

Digipology games run in the browser. Browse the catalog, choose a game, and use Quick Play or open a room of your own. An invitation is enough to join a private table.

Tables use WebGPU with a permanent WebGL fallback; for renderer testing, add `?renderer=lite` or `?renderer=webgl` to a table URL (Lite still falls back safely when WebGPU cannot start).

## Quick Play

Choose **Quick Play** on a game to go straight to a table. Digipology looks for a fresh public room for that game with an open seat, preferring the room that already has the most players. If no suitable room remains, it creates a new public room and seats you there.

Quick Play works for signed-in players and guests. When a guest has no saved display name, the server assigns a generated `Guest-…` name.

## Host a room

Open **Host a game**, choose a game, and select a visibility:

- A **private** room is invite-only. A guest can create one after entering a display name; no account is required.
- A **public** room can appear in the public-room list and accept players through Quick Play. Creating one requires an account, and the host dialog offers sign-in when a guest selects this option.

After the room is created, the host dialog shows its invite URL and lets you copy it before entering the table.

## Join with an invitation

Every room has an eight-character code displayed as `XXXX-XXXX` and a link shaped like `/join/<code>`. Paste either form into the home page's join field, or open the link directly.

A signed-in player joins with the name on the account. A guest is asked for a display name when the browser does not already have one, and that name is remembered for the next table in the same browser session. Guests can join, play, use Quick Play, and host private rooms without creating an account. Sign-in is reserved for account-bound actions such as publishing a game or hosting a public room.

If an invitation is invalid, full, or belongs to a table that has ended, the join page explains what happened and offers the relevant retry or return action.

## If the connection drops

The table attempts to reconnect automatically. The table remains visible while it catches up, but gameplay interactions pause until the connection is restored. If the connection cannot be restored or the room has ended, the table shows a message and an option to leave.

Rooms do not remain active forever after everyone leaves. After sustained inactivity, an empty room expires; returning players can host a new table from the catalog.
