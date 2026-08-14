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
    expect(request.tools[0]?.function.parameters).toEqual({
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
});
