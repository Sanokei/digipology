import { describe, expect, test } from "bun:test";

import {
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ParseErrorCode,
  type ParseResult,
  type ServerMessage,
} from "./index";

const orderedPlayer: ServerMessage = {
  type: "ordered_action",
  protocolVersion: 1,
  sequence: 1849,
  actionId: "act_room123_1849",
  requestId: "req_91",
  actor: { type: "player", playerId: "player_alice" },
  action: {
    type: "entity.grab",
    payload: { entityId: "ent_red_pawn" },
  },
};

const clientVariants: ClientMessage[] = [
  {
    type: "hello",
    protocolVersion: 1,
    sessionToken: "session_alice",
    lastSequence: null,
  },
  {
    type: "action_request",
    protocolVersion: 1,
    requestId: "req_91",
    predictedAtSequence: 1848,
    action: { type: "entity.grab", payload: null },
  },
  { type: "ping", protocolVersion: 1, t: 123.5 },
];

const serverVariants: ServerMessage[] = [
  {
    type: "bootstrap",
    protocolVersion: 1,
    sequence: 0,
    snapshot: { turn: 1 },
    players: [
      {
        playerId: "player_alice",
        displayName: "Alice",
        seatId: "seat_red",
        connected: true,
      },
    ],
  },
  {
    type: "resume",
    protocolVersion: 1,
    fromSequence: 1849,
    actions: [orderedPlayer],
  },
  { type: "resync_required", protocolVersion: 1 },
  {
    type: "protocol_error",
    protocolVersion: 1,
    code: "invalid_session",
    message: "Invalid session",
  },
  {
    type: "protocol_error",
    protocolVersion: 1,
    code: "bootstrap_unavailable",
    message: "This table is not ready for new players.",
  },
  { type: "room_ended", protocolVersion: 1, reason: "host_ended" },
  orderedPlayer,
  { type: "pong", protocolVersion: 1, t: 123.5 },
];

function expectFailure(
  result: ParseResult<unknown>,
  code: ParseErrorCode,
  path?: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected parsing to fail");
  expect(result.error.code).toBe(code);
  if (path !== undefined) expect(result.error.path).toBe(path);
}

describe("message round trips", () => {
  for (const message of clientVariants) {
    test(`round-trips client ${message.type}`, () => {
      const result = parseClientMessage(JSON.stringify(message));
      expect(result).toEqual({ ok: true, message });
    });
  }

  for (const message of serverVariants) {
    test(`round-trips server ${message.type}`, () => {
      const result = parseServerMessage(JSON.stringify(message));
      expect(result).toEqual({ ok: true, message });
    });
  }
});

const fixtureCases = [
  ["hello.json", "client"],
  ["hello-reconnect.json", "client"],
  ["appendix-d4-action-request.json", "client"],
  ["ping.json", "client"],
  ["ping-with-time.json", "client"],
  ["bootstrap.json", "server"],
  ["bootstrap-with-snapshot.json", "server"],
  ["resume.json", "server"],
  ["resync-required.json", "server"],
  ["protocol-error.json", "server"],
  ["room-ended.json", "server"],
  ["appendix-d4-ordered-action.json", "server"],
  ["ordered-action-system.json", "server"],
  ["pong.json", "server"],
  ["pong-with-time.json", "server"],
] as const;

describe("committed fixtures", () => {
  for (const [name, direction] of fixtureCases) {
    test(`parses and deep-compares ${name}`, async () => {
      const url = new URL(`../fixtures/${name}`, import.meta.url);
      const raw = (await Bun.file(url).text()).trimEnd();
      const expected = JSON.parse(raw) as ClientMessage | ServerMessage;
      const result =
        direction === "client"
          ? parseClientMessage(raw)
          : parseServerMessage(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message).toEqual(expected);
      }
    });
  }
});

describe("error classification", () => {
  const wrongVersions = [
    '{"type":"ping","protocolVersion":0}',
    '{"type":"ping","protocolVersion":2}',
    '{"type":"ping","protocolVersion":"1"}',
    '{"type":"ping"}',
  ];

  for (const raw of wrongVersions) {
    test(`classifies unsupported version in ${raw}`, () => {
      expectFailure(
        parseClientMessage(raw),
        "unsupported_protocol_version",
        "$.protocolVersion",
      );
    });
  }

  test("classifies an unknown type", () => {
    expectFailure(
      parseClientMessage('{"type":"dance","protocolVersion":1}'),
      "unknown_message_type",
      "$.type",
    );
  });

  test("classifies garbage JSON", () => {
    expectFailure(parseClientMessage("{"), "malformed_message", "$");
  });

  for (const root of ["[]", "null", '"hello"', "42"]) {
    test(`rejects non-object root ${root}`, () => {
      expectFailure(parseClientMessage(root), "malformed_message", "$");
    });
  }

  test("an empty object reports its missing protocol version first", () => {
    expectFailure(
      parseClientMessage("{}"),
      "unsupported_protocol_version",
      "$.protocolVersion",
    );
  });
});

describe("required fields and strict objects", () => {
  test("rejects a wrongly typed hello discriminator", () => {
    const raw =
      '{"type":7,"protocolVersion":1,"sessionToken":"s","lastSequence":null}';
    expectFailure(parseClientMessage(raw), "unknown_message_type", "$.type");
  });

  test("rejects a wrongly typed hello protocol version", () => {
    const raw =
      '{"type":"hello","protocolVersion":"1","sessionToken":"s","lastSequence":null}';
    expectFailure(
      parseClientMessage(raw),
      "unsupported_protocol_version",
      "$.protocolVersion",
    );
  });

  const invalidHelloCases: ReadonlyArray<readonly [string, string]> = [
    [
      '{"type":"hello","protocolVersion":1,"sessionToken":7,"lastSequence":null}',
      "$.sessionToken",
    ],
    [
      '{"type":"hello","protocolVersion":1,"lastSequence":null}',
      "$.sessionToken",
    ],
    [
      '{"type":"hello","protocolVersion":1,"sessionToken":"s","lastSequence":"0"}',
      "$.lastSequence",
    ],
    [
      '{"type":"hello","protocolVersion":1,"sessionToken":"s"}',
      "$.lastSequence",
    ],
  ];

  for (const [raw, path] of invalidHelloCases) {
    test(`rejects invalid hello field at ${path}`, () => {
      expectFailure(parseClientMessage(raw), "malformed_message", path);
    });
  }

  const invalidActionCases: ReadonlyArray<readonly [string, string]> = [
    [
      '{"type":"action_request","protocolVersion":1,"requestId":3,"predictedAtSequence":0,"action":{"type":"x","payload":null}}',
      "$.requestId",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"predictedAtSequence":0,"action":{"type":"x","payload":null}}',
      "$.requestId",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":-1,"action":{"type":"x","payload":null}}',
      "$.predictedAtSequence",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"requestId":"r","action":{"type":"x","payload":null}}',
      "$.predictedAtSequence",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":null}',
      "$.action",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0}',
      "$.action",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":{"type":2,"payload":null}}',
      "$.action.type",
    ],
    [
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":{"type":"x"}}',
      "$.action.payload",
    ],
  ];

  for (const [raw, path] of invalidActionCases) {
    test(`rejects invalid action_request field at ${path}`, () => {
      expectFailure(parseClientMessage(raw), "malformed_message", path);
    });
  }

  test("rejects wrongly typed action_request envelope fields", () => {
    const wrongType =
      '{"type":false,"protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":{"type":"x","payload":null}}';
    expectFailure(
      parseClientMessage(wrongType),
      "unknown_message_type",
      "$.type",
    );

    const wrongVersion =
      '{"type":"action_request","protocolVersion":null,"requestId":"r","predictedAtSequence":0,"action":{"type":"x","payload":null}}';
    expectFailure(
      parseClientMessage(wrongVersion),
      "unsupported_protocol_version",
      "$.protocolVersion",
    );
  });

  test("accepts every JSON payload shape", () => {
    for (const payload of [null, true, 3, "x", [1, 2], { nested: false }]) {
      const message: ClientMessage = {
        type: "action_request",
        protocolVersion: 1,
        requestId: "r",
        predictedAtSequence: 0,
        action: { type: "x", payload },
      };
      expect(parseClientMessage(JSON.stringify(message))).toEqual({
        ok: true,
        message,
      });
    }
  });

  test("rejects actor echoed by a client", () => {
    const raw =
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":{"type":"x","payload":null},"actor":{"type":"system"}}';
    expectFailure(parseClientMessage(raw), "malformed_message", "$.actor");
  });

  test("rejects extra fields in nested protocol objects", () => {
    const raw =
      '{"type":"ordered_action","protocolVersion":1,"sequence":1,"actionId":"a","actor":{"type":"system","playerId":"spoofed"},"action":{"type":"x","payload":null}}';
    expectFailure(
      parseServerMessage(raw),
      "malformed_message",
      "$.actor.playerId",
    );
  });
});

describe("adversarial JSON", () => {
  test("validates a payload nested 1000 levels without recursion", () => {
    let payload = "null";
    for (let depth = 0; depth < 1000; depth += 1) payload = `[${payload}]`;
    const raw =
      '{"type":"action_request","protocolVersion":1,"requestId":"deep","predictedAtSequence":0,"action":{"type":"x","payload":' +
      payload +
      "}}";
    expect(parseClientMessage(raw).ok).toBe(true);
  });

  test("rejects duplicate keys, including escaped-equivalent keys", () => {
    const duplicate =
      '{"type":"ping","protocolVersion":1,"protocolVersion":1}';
    expectFailure(parseClientMessage(duplicate), "malformed_message", "$");

    const escaped =
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":{"type":"x","payload":{"name":1,"n\\u0061me":2}}}';
    expectFailure(parseClientMessage(escaped), "malformed_message", "$");
  });

  test("preserves __proto__ as inert payload data", () => {
    const raw =
      '{"type":"action_request","protocolVersion":1,"requestId":"r","predictedAtSequence":0,"action":{"type":"x","payload":{"__proto__":{"polluted":true}}}}';
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (!result.ok || result.message.type !== "action_request") return;
    const payload = result.message.action.payload as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(payload, "__proto__")).toBe(true);
    expect(payload.__proto__).toEqual({ polluted: true });
  });
});

describe("UTF-8 size limits", () => {
  test("default ping limit accepts exactly 256 bytes and rejects 257", () => {
    const base = '{"type":"ping","protocolVersion":1}';
    const exact = base + " ".repeat(256 - base.length);
    expect(parseClientMessage(exact).ok).toBe(true);
    expectFailure(parseClientMessage(`${exact} `), "message_too_large");
  });

  test("an override accepts exactly its limit and rejects limit plus one", () => {
    const raw = '{"type":"ping","protocolVersion":1}';
    expect(parseClientMessage(raw, { maxBytes: raw.length }).ok).toBe(true);
    expectFailure(
      parseClientMessage(`${raw} `, { maxBytes: raw.length }),
      "message_too_large",
    );
  });

  test("rejects oversized input before calling JSON.parse", () => {
    const originalParse = JSON.parse;
    let parseCalled = false;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parseCalled = true;
      return originalParse(...args) as unknown;
    }) as typeof JSON.parse;
    try {
      expectFailure(
        parseClientMessage('{"type":"ping","protocolVersion":1}', {
          maxBytes: 1,
        }),
        "message_too_large",
      );
      expect(parseCalled).toBe(false);
    } finally {
      JSON.parse = originalParse;
    }
  });

  test("counts multibyte UTF-8 rather than UTF-16 code units", () => {
    const raw =
      '{"type":"action_request","protocolVersion":1,"requestId":"é","predictedAtSequence":0,"action":{"type":"x","payload":null}}';
    const utf8Bytes = raw.length + 1;
    expect(parseClientMessage(raw, { maxBytes: utf8Bytes }).ok).toBe(true);
    expectFailure(
      parseClientMessage(raw, { maxBytes: utf8Bytes - 1 }),
      "message_too_large",
    );
  });

  test("rejects invalid maxBytes as a programmer error", () => {
    expect(() => parseClientMessage("{}", { maxBytes: -1 })).toThrow(RangeError);
    expect(() =>
      parseClientMessage("{}", { maxBytes: 1.5 }),
    ).toThrow(RangeError);
  });
});
