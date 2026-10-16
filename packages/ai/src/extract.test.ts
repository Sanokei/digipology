import { describe, expect, test } from "bun:test";

import {
  extractToolPayload,
  salvageTruncatedJson,
  stripMarkdownFences,
  stripModelArtifacts,
} from "./extract";

function record(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function responseWithArguments(...argumentsTexts: string[]): unknown {
  return {
    choices: [
      {
        message: {
          tool_calls: argumentsTexts.map((argumentsText) => ({
            function: { arguments: argumentsText },
          })),
        },
      },
    ],
  };
}

describe("stripMarkdownFences", () => {
  test("unwraps a fenced json block", () => {
    expect(stripMarkdownFences('```json\n{"value":1}\n```')).toBe('{"value":1}');
  });

  test("unwraps a bare fence block", () => {
    expect(stripMarkdownFences('```\n{"value":1}\n```')).toBe('{"value":1}');
  });

  test("removes stray fence lines around prose", () => {
    expect(stripMarkdownFences('```json\n{"value":1}\n```\nDone!')).toBe('{"value":1}\n\nDone!');
  });

  test("leaves unfenced text untouched", () => {
    expect(stripMarkdownFences('{"value":1}')).toBe('{"value":1}');
  });
});

describe("stripModelArtifacts", () => {
  test("removes real fullwidth-bar DSML tags", () => {
    const leak = '<｜｜DSML｜｜parameter name="top" string="true">';
    expect(stripModelArtifacts(`before${leak}after`)).toBe("beforeafter");
  });
});

describe("salvageTruncatedJson", () => {
  test("closes a mid-string cut", () => {
    expect(salvageTruncatedJson('{"title":"unfinished')).toEqual({
      title: "unfinished",
    });
  });

  test("drops a mid-key cut and keeps the intact prefix", () => {
    expect(salvageTruncatedJson('{"title":"kept","bro')).toEqual({
      title: "kept",
    });
  });

  test("closes nested arrays and objects", () => {
    expect(salvageTruncatedJson('{"items":[1,{"ok":true')).toEqual({
      items: [1, { ok: true }],
    });
  });

  test("repairs a trailing comma", () => {
    expect(salvageTruncatedJson('{"a":1,')).toEqual({ a: 1 });
  });

  test("drops a value cut after a trailing colon", () => {
    expect(salvageTruncatedJson('{"a":1,"broken":')).toEqual({ a: 1 });
  });

  test("returns null after at most 64 pathological chop attempts", () => {
    const pathological = `{"a":${',"a":'.repeat(70)}`;
    expect(salvageTruncatedJson(pathological)).toBeNull();
  });
});

describe("extractToolPayload ladder", () => {
  test("rung 1 parses each call verbatim and does not strip valid string data", () => {
    const dsmlAsData = '<｜｜DSML｜｜parameter name="top" string="true">';
    const response = responseWithArguments("not-json", JSON.stringify({ value: dsmlAsData }));
    expect(extractToolPayload(response, record)).toEqual({ value: dsmlAsData });
  });

  test("rung 2 joins split arguments and strips interleaved DSML leaks", () => {
    const leak = '<｜｜DSML｜｜parameter name="top" string="true">';
    const response = responseWithArguments(
      `{"top":${leak}"yes",`,
      '"count":2}',
    );
    expect(extractToolPayload(response, record)).toEqual({ top: "yes", count: 2 });
  });

  test("rung 3 salvages joined, cleaned truncation", () => {
    const response = responseWithArguments('{"name":"kept","items":[1,2');
    expect(extractToolPayload(response, record)).toEqual({
      name: "kept",
      items: [1, 2],
    });
  });

  test("rung 4 uses the first balanced content object and repeats salvage", () => {
    const response = {
      choices: [
        {
          message: {
            tool_calls: [{ function: { arguments: "invalid" } }],
            content: 'prose {"value":"first","broken":} then {"value":"second"}',
          },
        },
      ],
    };
    expect(extractToolPayload(response, record)).toEqual({ value: "first" });
  });

  test("rung 4 extracts a fenced payload without any tool calls", () => {
    const response = {
      choices: [
        { message: { content: '```json\n{"value":"fenced"}\n```' } },
      ],
    };
    expect(extractToolPayload(response, record)).toEqual({ value: "fenced" });
  });

  test("rung 4 extracts whole unfenced content verbatim", () => {
    const response = {
      choices: [
        { message: { content: '  {"value":"whole"}  ' } },
      ],
    };
    expect(extractToolPayload(response, record)).toEqual({ value: "whole" });
  });

  test("rung 4 salvages a truncated fenced payload", () => {
    const response = {
      choices: [
        { message: { content: '```json\n{"value":"kept","items":[1,2' } },
      ],
    };
    expect(extractToolPayload(response, record)).toEqual({
      value: "kept",
      items: [1, 2],
    });
  });

  test("rung 5 returns null when every source is unusable", () => {
    const response = {
      choices: [{ message: { tool_calls: [], content: "no object here" } }],
    };
    expect(extractToolPayload(response, record)).toBeNull();
  });

  test("every parsed candidate passes through normalize", () => {
    const normalized = extractToolPayload(
      responseWithArguments('{"value":"TOO-LONG"}'),
      (raw) => {
        const object = record(raw);
        return typeof object?.value === "string"
          ? { value: object.value.slice(0, 3).toLowerCase() }
          : null;
      },
    );
    expect(normalized).toEqual({ value: "too" });
  });
});
