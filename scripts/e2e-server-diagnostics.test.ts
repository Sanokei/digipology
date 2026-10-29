import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractWranglerFailure, parseMemoryEvents, parseProcessStatus, readWranglerFailure } from "./e2e-server-diagnostics";

const entry = (level: string, value: string) => `\n--- 2026-10-29T22:19:08.113Z ${level}\n${value}\n---\n`;

test("blank Wrangler error retains actual exception type/code and dependency frames without message payloads", () => {
  const raw = entry("debug", 'config: {SESSION_SECRET:"secret-value", rule:"ctx.private_input()", Cookie:"private-cookie"}')
    + entry("error", "✘ [ERROR] ")
    + entry("debug", "AggregateError [ECONNREFUSED]: https://user:password@example.com/api?token=secret-value Cookie=private-cookie\n    at async Promise.all (index 0)\n    at start (/home/private-user/repo/node_modules/wrangler/wrangler-dist/cli.js:12:34)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)");
  expect(extractWranglerFailure(raw)).toEqual({ errorRecords: 1, blankErrorRecords: 1, messagesOmitted: true, exceptions: [{ name: "AggregateError", codes: ["ECONNREFUSED"], stack: [{ source: "node_modules/wrangler/wrangler-dist/cli.js", line: 12, column: 34 }, { source: "node:internal/process/task_queues", line: 105, column: 5 }] }] });
  const serialized = JSON.stringify(extractWranglerFailure(raw));
  for (const secret of ["secret-value", "private-cookie", "password", "example.com", "ctx.private_input", "private-user", "SESSION_SECRET"]) expect(serialized).not.toContain(secret);
});

test("stack URL queries, credentials, arbitrary names and authored source are omitted by allowlist", () => {
  const raw = entry("error", "rule source:\nfunction hidden_action() end")
    + entry("debug", "PrivateGameError: Authorization: Bearer super-secret ERR_PRIVATE_TOKEN\n    at run (https://user:pass@example.com/private.js?token=abc:50:2)\n    at load (https://example.com/node_modules/miniflare/dist/index.js?cookie=abc:60:3)\n    at evaluate (/tmp/private-draft/worker-build/index.js:70:4)\n    at run (/tmp/private-rule.lua:80:5)");
  expect(extractWranglerFailure(raw).exceptions[0]).toEqual({ name: "OtherError", codes: [], stack: [{ source: "<external source>", line: 50, column: 2 }, { source: "node_modules/miniflare/dist/index.js", line: 60, column: 3 }, { source: "<worker-build>/index.js", line: 70, column: 4 }, { source: "<external source>", line: 80, column: 5 }] });
  expect(JSON.stringify(extractWranglerFailure(raw))).not.toMatch(/private|super-secret|token|cookie|user:pass|example\.com/i);
});

test("raw error excerpts without a stack never become retained diagnostics", () => {
  const raw = entry("debug", "configuration and full authored rules") + entry("error", "Cookie: private\nAuthorization: Bearer secret\nfunction check(ctx) end");
  expect(extractWranglerFailure(raw)).toEqual({ errorRecords: 1, blankErrorRecords: 0, exceptions: [], messagesOmitted: true });
});

test("process and memory parsing exposes numeric probes rather than arbitrary status fields", () => {
  expect(parseProcessStatus("Name:\tworkerd\nVmRSS:\t1234 kB\nVmHWM:\t2345 kB\nVmPeak:\t4567 kB\nThreads:\t8\nSECRET:\tprivate\n")).toEqual({ process: "workerd", rssKiB: 1234, peakKiB: 2345, virtualPeakKiB: 4567, threads: 8 });
  expect(parseMemoryEvents("low 0\nhigh 1\nmax 2\noom 3\noom_kill 4\noom_group_kill 0\nsecret 123\n")).toEqual({ low: 0, high: 1, max: 2, oom: 3, oom_kill: 4, oom_group_kill: 0 });
});

test("bounded private-log reader returns safe projection and missing-log state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "e2e-diagnostics-test-"));
  try {
    const path = join(directory, "private.log");
    expect(await readWranglerFailure(path)).toEqual({ logStatus: "missing" });
    await writeFile(path, "private-rule".repeat(20_000) + entry("debug", "TypeError: secret\n    at run (node:internal/process/task_queues:10:2)"));
    const result = await readWranglerFailure(path);
    expect(result).toMatchObject({ logStatus: "available", tailLimited: true, tailBytes: 128 * 1024, messagesOmitted: true, exceptions: [{ name: "TypeError", codes: [], stack: [{ source: "node:internal/process/task_queues", line: 10, column: 2 }] }] });
    expect(JSON.stringify(result)).not.toMatch(/private-rule|secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
