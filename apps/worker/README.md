# digipology-worker

Private Cloudflare Worker and `RoomDO` sequencing skeleton for Digipology rooms.
The Durable Object validates the shared wire protocol, authenticates room-scoped
sessions, assigns canonical sequence numbers, deduplicates request IDs, retains
the latest 500 actions, and supports reconnect catch-up. It never imports or
runs the game kernel or inspects game-specific action payloads.

## Room addressing

Version 0 needs no global KV/D1 room index. A cryptographically random,
seven-character join code names the Room Durable Object through
`ROOM.idFromName(joinCode)`. The resulting Durable Object ID string is the
public `roomId`; joining normalizes whitespace/case, derives the same object,
and asks that object to validate its own persisted metadata. The 32-character
unambiguous alphabet provides `32^7 = 2^35` possible join codes. A future D1
index can replace this lookup without changing Room sequencing.

Session tokens contain 192 random bits and are stored only in the Room DO.
They are returned once by the join endpoint and never logged.

## Local development

From the repository root:

```sh
bun install
cd apps/worker
bun run dev
```

The API listens on Wrangler's displayed local URL (normally
`http://127.0.0.1:8787`). In another terminal run:

```sh
cd apps/worker
bun run smoke
```

Set `WORKER_URL` if Wrangler uses a different origin. The smoke script creates a
room, joins two normalized clients, performs both hello handshakes, checks a
broadcast ordered action, retries the same request ID, and reconnects with
resume. It also fills the room to the default eight-player cap and verifies the
ninth join receives HTTP 409.

For the manual v0 end path:

```text
POST /api/rooms/:roomId/end
```

An empty room also schedules a configurable 30-minute alarm and ends as
`expired` if it remains empty. Full lifecycle policy is intentionally deferred.

## Verification

```sh
bun test apps/worker
bun run --cwd apps/worker typecheck
```
