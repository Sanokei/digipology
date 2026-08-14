import { afterEach, describe, expect, test } from "bun:test";

import type { DeepSeekRequest } from "./request";
import { makeDeepseekFetch } from "./transport";

const request: DeepSeekRequest = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  tool_choice: { type: "function", function: { name: "emit" } },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("makeDeepseekFetch", () => {
  test("returns null for missing and empty keys", () => {
    expect(makeDeepseekFetch({ apiKey: undefined })).toBeNull();
    expect(makeDeepseekFetch({ apiKey: "" })).toBeNull();
  });

  test("posts the OpenAI-compatible request with authorization", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const port = makeDeepseekFetch({
      apiKey: "secret",
      baseUrl: "https://deepseek.example/",
    });
    expect(port).not.toBeNull();
    expect(await port!(request, 100)).toEqual({ ok: true });
    expect(seenUrl).toBe("https://deepseek.example/chat/completions");
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer secret",
    });
    expect(seenInit?.body).toBe(JSON.stringify(request));
  });

  test("aborts at timeout and resolves null", async () => {
    let aborted = false;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      })) as unknown as typeof fetch;

    const port = makeDeepseekFetch({ apiKey: "secret" });
    expect(await port!(request, 1)).toBeNull();
    expect(aborted).toBeTrue();
  });

  test("resolves null for a non-2xx response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "no" }), {
        status: 503,
      })) as unknown as typeof fetch;
    const port = makeDeepseekFetch({ apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });

  test("resolves null for unparseable response JSON", async () => {
    globalThis.fetch = (async () =>
      new Response("not-json", { status: 200 })) as unknown as typeof fetch;
    const port = makeDeepseekFetch({ apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });

  test("resolves null when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const port = makeDeepseekFetch({ apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });
});
