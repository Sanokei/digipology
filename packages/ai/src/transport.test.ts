import { afterEach, describe, expect, test } from "bun:test";

import type { ModelRequest } from "./request";
import { makeModelFetch, DEFAULT_MODEL_BASE_URL } from "./transport";

const request: ModelRequest = {
  model: "qwen3-0.6b",
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  tool_choice: { type: "function", function: { name: "emit" } },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("makeModelFetch", () => {
  test("returns null only when baseUrl is explicitly empty without a key", () => {
    expect(makeModelFetch({ baseUrl: "" })).toBeNull();
    expect(makeModelFetch({ baseUrl: "", apiKey: "" })).toBeNull();
    expect(makeModelFetch({})).not.toBeNull();
    expect(makeModelFetch({ apiKey: "secret" })).not.toBeNull();
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

    const port = makeModelFetch({
      apiKey: "secret",
      baseUrl: "https://qwen.example/",
    });
    expect(port).not.toBeNull();
    expect(await port!(request, 100)).toEqual({ ok: true });
    expect(seenUrl).toBe("https://qwen.example/chat/completions");
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer secret",
    });
    expect(seenInit?.body).toBe(JSON.stringify(request));
  });
  test("merges extraBody into the top-level POST body and strips the key", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      seenInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const port = makeModelFetch({ baseUrl: "https://qwen.example/" });
    expect(port).not.toBeNull();
    await port!({ ...request, extraBody: { enable_thinking: false } }, 100);
    const body = JSON.parse(String(seenInit?.body)) as Record<string, unknown>;
    expect(body.enable_thinking).toBe(false);
    expect("extraBody" in body).toBe(false);
    expect(body.model).toBe("qwen3-0.6b");
  });

  test("omits the authorization header when keyless", async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      seenInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const port = makeModelFetch({ baseUrl: "https://qwen.example/" });
    expect(port).not.toBeNull();
    await port!(request, 100);
    const headers = seenInit?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect("authorization" in (headers ?? {})).toBeFalse();
  });

  test("uses the local default base URL when omitted", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const port = makeModelFetch({});
    expect(port).not.toBeNull();
    await port!(request, 100);
    expect(seenUrl.startsWith(DEFAULT_MODEL_BASE_URL)).toBeTrue();
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

    const port = makeModelFetch({ apiKey: "secret" });
    expect(await port!(request, 1)).toBeNull();
    expect(aborted).toBeTrue();
  });

  test("resolves null for a non-2xx response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "no" }), {
        status: 503,
      })) as unknown as typeof fetch;
    const port = makeModelFetch({ apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });

  test("resolves null for unparseable response JSON", async () => {
    globalThis.fetch = (async () =>
      new Response("not-json", { status: 200 })) as unknown as typeof fetch;
    const port = makeModelFetch({ apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });

  test("resolves null when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const port = makeModelFetch({ apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });
});
