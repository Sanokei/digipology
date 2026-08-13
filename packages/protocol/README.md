# digipology-protocol

Shared TypeScript types and zero-dependency parsers for version 1 of the
Digipology client-to-Room wire protocol. The package is made only of pure types
and pure functions and is suitable for browsers, Bun, and Cloudflare Workers.

Every wire message has `protocolVersion: 1` and a `type` discriminator. Parsers
treat JSON as untrusted input, never throw for malformed input, reject duplicate
object keys, and reject unknown fields. The strict unknown-field policy applies
to protocol-owned objects (messages, actions, actors, and player records), but
not to opaque `action.payload` or `snapshot` JSON. Adding a protocol field
therefore requires a new protocol version or an explicitly declared optional
field.

## API

```ts
import {
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ParseResult,
  type ServerMessage,
} from "digipology-protocol";

const result = parseClientMessage(frameText);
if (result.ok) {
  handleClientMessage(result.message);
} else {
  logProtocolFailure(result.error.code, result.error.path, result.error.detail);
}
```

```ts
parseClientMessage(json, { maxBytes: 8 * 1024 });
parseServerMessage(json, { maxBytes: 128 * 1024 });
```

`maxBytes` overrides the default for that call. It must be a non-negative safe
integer; an invalid option is a programmer error and throws. Input size is
measured as UTF-8 bytes, not JavaScript UTF-16 code units, and oversized input
is rejected before `JSON.parse` is called.

The exported `ParseResult<T>` is either `{ ok: true, message: T }` or
`{ ok: false, error }`. Parse errors have a `code`, human-readable `detail`, and
usually a JSONPath-like `path` such as `$.action.type`.

## Client messages

- `hello` begins or restores a room connection. `sessionToken` authenticates a
  room/player session. `lastSequence` is the last canonical sequence held by the
  client, or `null` for a fresh join.
- `action_request` submits one unsequenced action. `requestId` is the client's
  idempotency key, `predictedAtSequence` is the confirmed sequence against which
  it predicted, and `action` contains a string `type` plus any JSON `payload`.
  Actor identity is deliberately absent: the Room derives it from the
  authenticated session.
- `ping` is a liveness message. Optional finite number `t` may be echoed by a
  `pong`.

## Server messages

- `bootstrap` initializes a client at non-negative integer `sequence`.
  `snapshot`, when present, is opaque JSON. `players` contains the current room
  roster.
- `resume` starts at non-negative integer `fromSequence` and supplies complete
  `ordered_action` messages in `actions`.
- `resync_required` tells the client that incremental recovery is unavailable
  and a full resynchronization is required.
- `protocol_error` reports a protocol `code` and a human-readable `message`.
- `room_ended` terminates the room with reason `host_ended`, `expired`, or
  `moderation`.
- `ordered_action` is a canonical action at non-negative integer `sequence`.
  `actionId` identifies that canonical action. Optional `requestId` appears only
  for actions originating from a client request. `actor` is either
  `{ type: "player", playerId }` or `{ type: "system" }`; it is authoritative
  server data. `action.payload` may be any JSON value and game-specific
  validation remains the kernel action registry's responsibility.
- `pong` is the server liveness response and may carry optional finite number
  `t`.

Each `PlayerInfo` contains string `playerId` and `displayName`, nullable string
`seatId`, and boolean `connected`.

## Protocol error codes

The wire-level `ProtocolErrorCode` vocabulary is:

- `unsupported_protocol_version`: peer does not support the requested version.
- `invalid_session`: the session token is invalid, revoked, or out of scope.
- `malformed_message`: JSON structure or field values are invalid.
- `message_too_large`: a configured message-size limit was exceeded.
- `rate_limited`: the sender exceeded a service rate limit.
- `unknown_message_type`: the message discriminator is not recognized.

Parser failures use the applicable subset: `malformed_message`,
`unsupported_protocol_version`, `unknown_message_type`, and
`message_too_large`. A missing `protocolVersion`, as well as `0`, `2`, or
`"1"`, is reported as `unsupported_protocol_version`.

## Default size limits

| Message | Default limit |
| --- | ---: |
| `hello` | 4 KiB |
| `action_request` | 32 KiB |
| `ping` / `pong` | 256 B |
| `ordered_action` | 64 KiB |
| `bootstrap` / `resume` | 4 MiB |
| `resync_required` / `protocol_error` / `room_ended` | 4 KiB |

These parser limits supplement, rather than replace, transport-level caps and
rate limits enforced by the Room service.

## Validation boundaries

JSON syntax, duplicate keys, protocol version, discriminator, required and
optional field types, finite/safe sequence numbers, actors, players, and strict
field sets are checked here. Payload and snapshot contents are checked only to
ensure they are JSON values. The validator walks those values iteratively, so a
deeply nested payload does not consume the JavaScript call stack.
