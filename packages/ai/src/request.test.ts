import { describe, expect, test } from "bun:test";

import { BOOL, NUM, STR, buildRequest } from "./request";

describe("request builders", () => {
  test("schema property helpers emit the expected JSON Schema fragments", () => {
    expect(STR("A title")).toEqual({ type: "string", description: "A title" });
    expect(NUM("A count")).toEqual({ type: "number", description: "A count" });
    expect(BOOL("A switch")).toEqual({ type: "boolean", description: "A switch" });
  });

  test("buildRequest creates and pins a strict function tool", () => {
    const request = buildRequest({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "Build it" }],
      tool: {
        name: "emit_result",
        description: "Emit a result",
        properties: {
          title: STR("Title"),
          mode: { type: "string", enum: ["short", "long"] },
        },
        required: ["title", "mode"],
      },
      maxTokens: 512,
      temperature: 0.2,
    });

    expect(request.tool_choice).toEqual({
      type: "function",
      function: { name: "emit_result" },
    });
    expect(request.tools?.[0]?.function.parameters).toEqual({
      type: "object",
      properties: {
        title: { type: "string", description: "Title" },
        mode: { type: "string", enum: ["short", "long"] },
      },
      required: ["title", "mode"],
      additionalProperties: false,
    });
    expect(request).not.toHaveProperty("response_format");
  });
  test("buildRequest carries extraBody through only when provided", () => {
    const base = {
      model: "qwen3-0.6b",
      messages: [{ role: "user", content: "Build it" }] as const,
      tool: {
        name: "emit_result",
        description: "Emit a result",
        properties: { title: STR("Title") },
        required: ["title"],
      },
    };

    const withExtra = buildRequest({
      ...base,
      messages: [...base.messages],
      extraBody: { enable_thinking: false },
    });
    expect(withExtra.extraBody).toEqual({ enable_thinking: false });

    const withoutExtra = buildRequest({
      ...base,
      messages: [...base.messages],
    });
    expect(withoutExtra).not.toHaveProperty("extraBody");
  });

  test("buildRequest without a tool omits tools and tool_choice for the raw-JSON path", () => {
    const request = buildRequest({
      model: "qwen3-0.6b",
      messages: [{ role: "user", content: "Emit raw JSON." }],
      maxTokens: 3000,
      temperature: 0.35,
      extraBody: { enable_thinking: false },
    });
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("tool_choice");
    expect(request.max_tokens).toBe(3000);
    expect(request.temperature).toBe(0.35);
    expect(request.extraBody).toEqual({ enable_thinking: false });
    // The wire body must not leak an undefined tools key either.
    expect(JSON.parse(JSON.stringify(request)) as Record<string, unknown>)
      .not.toHaveProperty("tools");
  });
});
