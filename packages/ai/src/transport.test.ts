import { afterEach, describe, expect, test } from "bun:test";

import type { ModelRequest } from "./request";
import { applyModelProfile, buildRequest } from "./request";
import { makeModelFetch, LOCAL_MODEL_BASE_URL } from "./transport";

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
  test("rejects credentialed URLs, non-loopback HTTP, unsupported URL fields and protocols", () => {
    for (const baseUrl of ["http://model.example/v1", "https://user:password@model.example/v1", "https://model.example/v1?key=hidden", "https://model.example/v1#fragment", "file:///tmp/model", "not a URL"]) expect(makeModelFetch({ baseUrl, apiKey: "secret" })).toBeNull();
  });

  test("profiles stay explicit, do not mutate callers, and Qwen suppression follows retry feedback", () => {
    const original = { ...request, max_tokens: 24_000, temperature: 0.35 };
    const before = JSON.stringify(original);
    const neutral = applyModelProfile(original, "openai-compatible");
    expect(neutral).toEqual(original);
    const openai = applyModelProfile(original, "openai");
    expect(openai.max_completion_tokens).toBe(24_000);
    expect(openai.max_tokens).toBeUndefined();
    expect(openai.temperature).toBeUndefined();
    const retry = { ...original, messages: [...original.messages, { role: "user" as const, content: "Repair the rejected JSON" }] };
    const qwen = applyModelProfile(retry, "qwen-local");
    expect(qwen.messages.at(-1)?.content).toBe("Repair the rejected JSON /no_think");
    expect(qwen.extraBody).toEqual({ enable_thinking: false });
    expect(applyModelProfile(qwen, "qwen-local")).toEqual(qwen);
    expect(JSON.stringify(original)).toBe(before);
    expect(retry.messages.at(-1)?.content).toBe("Repair the rejected JSON");
  });

  test("actual loopback HTTP receives the OpenAI profile without unsupported defaults", async () => {
    let seen: { path: string; authorization: string | null; body: Record<string, unknown> } | null = null;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(input) {
      seen = { path: new URL(input.url).pathname, authorization: input.headers.get("Authorization"), body: await input.json() as Record<string, unknown> };
      return Response.json({ choices: [{ message: { content: '{"fixture":true}' } }] });
    } });
    try {
      const port = makeModelFetch({ baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "test-only-key", profile: "openai" })!;
      const payload = buildRequest({ model: "account-model", profile: "openai", jsonObject: true, messages: [{ role: "user", content: "Return a JSON object" }], maxTokens: 24_000, temperature: 0.35 });
      const response = await port(payload, 2_000);
      expect(response).not.toBeNull();
      const captured = seen! as { path: string; authorization: string | null; body: Record<string, unknown> };
      expect(captured.path).toBe("/v1/chat/completions");
      expect(captured.authorization).toBe("Bearer test-only-key");
      expect(captured.body).toEqual({ model: "account-model", messages: [{ role: "user", content: "Return a JSON object" }], max_completion_tokens: 24_000, response_format: { type: "json_object" } });
    } finally { await server.stop(true); }
  });

  test("redirect handling does not forward credentials and extraBody cannot override core request fields", async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => { seen = init; return Response.json({ ok: true }); }) as typeof fetch;
    await makeModelFetch({ baseUrl: "https://model.example/v1", apiKey: "secret", profile: "openai" })!({ ...request, max_tokens: 8_000, extraBody: { model: "unexpected-model", enable_thinking: true, max_tokens: 1, temperature: 2 } }, 100);
    expect(seen?.redirect).toBe("manual");
    const body = JSON.parse(String(seen?.body));
    expect(body.model).toBe(request.model);
    expect(body.max_completion_tokens).toBe(8_000);
    expect(body).not.toHaveProperty("enable_thinking");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  test("a real redirect fails before its target receives a credentialed request", async () => {
    let targetCalls = 0;
    const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { targetCalls += 1; return Response.json({ ok: true }); } });
    const origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${target.port}/capture` } }); } });
    try {
      const result = await makeModelFetch({ baseUrl: `http://127.0.0.1:${origin.port}/v1`, apiKey: "test-only-key" })!(request, 2_000);
      expect(result).toBeNull();
      expect(targetCalls).toBe(0);
    } finally { await origin.stop(true); await target.stop(true); }
  });

  test("requires an explicit endpoint even when a credential exists", () => {
    expect(makeModelFetch({ baseUrl: "" })).toBeNull();
    expect(makeModelFetch({ baseUrl: "", apiKey: "" })).toBeNull();
    expect(makeModelFetch({})).toBeNull();
    expect(makeModelFetch({ apiKey: "secret" })).toBeNull();
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

  test("uses loopback only when explicitly selected", async () => {
    let seenUrl = "";
    globalThis.fetch = (async (input) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const port = makeModelFetch({ baseUrl: LOCAL_MODEL_BASE_URL });
    expect(port).not.toBeNull();
    await port!(request, 100);
    expect(seenUrl.startsWith(LOCAL_MODEL_BASE_URL)).toBeTrue();
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

    const port = makeModelFetch({ baseUrl: "https://model.example/v1", apiKey: "secret" });
    expect(await port!(request, 1)).toBeNull();
    expect(aborted).toBeTrue();
  });

  test("resolves null for a non-2xx response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "no" }), {
        status: 503,
      })) as unknown as typeof fetch;
    const port = makeModelFetch({ baseUrl: "https://model.example/v1", apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });

  test("resolves null for unparseable response JSON", async () => {
    globalThis.fetch = (async () =>
      new Response("not-json", { status: 200 })) as unknown as typeof fetch;
    const port = makeModelFetch({ baseUrl: "https://model.example/v1", apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });

  test("resolves null when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const port = makeModelFetch({ baseUrl: "https://model.example/v1", apiKey: "secret" });
    expect(await port!(request, 100)).toBeNull();
  });
});
