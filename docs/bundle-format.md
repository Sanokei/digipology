---
title: Release bundle format v1
description: The JSON upload contract, immutable integrity chain, validation checks, and lifecycle for Digipology community game releases.
---

# Digipology release bundle format v1

A release bundle is one UTF-8 JSON object, at most 1 MiB as an upload request. Published bundles are immutable. The platform assigns the final `gameId`, `releaseId`, and `releaseNumber`, recomputes the snapshot and manifest hashes for those identifiers, and stores the canonical JSON at `releases/<releaseId>.json`.

The desktop editor assembles this format for you and hands it to the same validated create flow described below. See the [creator guide](./creator-guide.md) for the authoring, playtest, export, and publish workflow.

```json
{
  "formatVersion": 1,
  "gameId": "draft_my_game",
  "releaseId": "draft_my_game_1",
  "releaseNumber": 1,
  "kernelVersion": 1,
  "luaApiVersion": 1,
  "luaStdlibVersion": 1,
  "networkProtocolVersion": 1,
  "interactionMode": "sandbox",
  "minPlayers": 2,
  "maxPlayers": 4,
  "files": [
    {
      "path": "runtime/game.json",
      "contentHash": "sha256:...",
      "byteLength": 28142,
      "content": "{...}"
    }
  ],
  "refs": { "main_deck": "entity_deck_01" },
  "integrity": { "manifestHash": "sha256:..." },
  "initialSnapshot": {
    "formatVersion": 1,
    "kernelVersion": 1,
    "releaseId": "draft_my_game_1",
    "sequence": 0,
    "state": {
      "schemaVersion": 1,
      "sequence": 0,
      "releaseId": "draft_my_game_1",
      "kernelVersion": 1,
      "settings": {},
      "rng": { "algorithm": "sfc32-v1", "state": [1, 2, 3, 4], "draws": 0 },
      "players": {},
      "seats": {},
      "entities": {},
      "scriptState": {},
      "prompts": {}
    },
    "stateHash": "sha256:..."
  }
}
```

`interactionMode` is `sandbox` or `scripted`. Player limits are integers from 1 through 64, `minPlayers <= maxPlayers`, and must match the publish form. A bundle contains 1–256 unique files. File paths start with `runtime/` or `scripts/`; file content is an inline string. `refs` optionally maps safe Lua identifiers to immutable entity IDs. `luaStdlibVersion` pins the deterministic `turns`/`scores` package separately from `kernelVersion` and `luaApiVersion`; bundles created before this field default to version 1.

`title` and `definitions` may be included. A definition maps an ID to optional plain-text `label` and `color` strings. Game title, tagline, and creator handle are always treated as untrusted plain text by the site, never HTML or Markdown.

## Integrity chain

Each `contentHash` is SHA-256 over the file content's raw UTF-8 bytes, written as `sha256:<64 lowercase hex characters>`. `byteLength` is the length of those same bytes.

`manifestHash` is the canonical-JSON hash of this object, deliberately excluding `integrity`, `initialSnapshot`, optional presentation fields, and each file's `content`:

```json
{
  "formatVersion": 1,
  "gameId": "...",
  "releaseId": "...",
  "releaseNumber": 1,
  "kernelVersion": 1,
  "luaApiVersion": 1,
  "luaStdlibVersion": 1,
  "networkProtocolVersion": 1,
  "interactionMode": "sandbox",
  "minPlayers": 2,
  "maxPlayers": 4,
  "files": [{ "path": "runtime/game.json", "contentHash": "sha256:...", "byteLength": 28142 }],
  "refs": { "main_deck": "entity_deck_01" }
}
```

`initialSnapshot.stateHash` is the canonical-JSON SHA-256 hash of `initialSnapshot.state`. Snapshot metadata must match the state, the snapshot must load through kernel v1, and its sequence must be zero. On publication, the service clears draft player membership and leaves seats unoccupied; room membership is sequenced by the Room Durable Object.

## Validation pipeline

Both `/create` and the Worker run the same ordered checks and show a per-check result:

1. request DTO shape and exact keys;
2. 1 MiB request size;
3. slug format and server-side uniqueness, including built-ins;
4. canonical-JSON compatibility;
5. exact bundle/file shape;
6. every file byte length and content hash;
7. manifest hash;
8. snapshot state hash;
9. kernel `loadSnapshot`;
10. all v1 version pins; and
11. sane, matching player limits.

Any failure returns HTTP 422 with `{error: {code: "validation_failed", message}, report: [...]}` and persists nothing.

The server deliberately does **not** execute uploaded Lua during publication. Safe server execution requires separately specified CPU, memory, recursion, and failure budgets inside a Worker request. MVP publication instead enforces the release integrity chain (`ReleaseRecord -> manifestHash -> manifest -> file hashes`) and the loadable canonical snapshot. Lua executes only in the hostile-input client sandbox; server-side budgeted execution remains a follow-up.

## Lifecycle

Publishing a game creates release 1. Publishing again creates N+1 even when the input bytes match an earlier draft. R2 artifacts are written first; the D1 latest-release pointer moves only after the immutable object write succeeds. There are no update or delete routes for releases.

Games are `public` or `unlisted`. Unlisting is the MVP takedown mechanism: the game leaves browse results, while existing rooms pinned to an immutable release and direct bundle retrieval continue to work. Hard deletion is not supported.
