import { open, readFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const LOG_TAIL_BYTES = 128 * 1024;
const ERROR_NAMES = new Set(["Error", "AggregateError", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "DOMException", "AbortError", "TimeoutError", "RuntimeError", "MiniflareCoreError", "MiniflareError", "FatalError", "UserError", "APIError", "ParseError"]);
const SYSTEM_CODES = /\b(?:ERR_ASSERTION|ERR_RUNTIME_FAILURE|ERR_WORKER_OUT_OF_MEMORY|ERR_UNHANDLED_ERROR|ERR_STREAM_DESTROYED|ERR_STREAM_PREMATURE_CLOSE|ERR_STREAM_WRITE_AFTER_END|ERR_SERVER_NOT_RUNNING|ERR_SOCKET_CLOSED|EACCES|EADDRINUSE|EADDRNOTAVAIL|ECONNABORTED|ECONNREFUSED|ECONNRESET|EPIPE|ENOENT|ENOMEM|EMFILE|ENFILE|ENOSPC|EPERM|ETIMEDOUT)\b/g;

type StackLocation = { source: string; line: number; column: number };
function stackLocation(source: string, line: string, column: string): StackLocation {
  // Retain dependency and Node locations, never user paths, query strings,
  // function arguments, source excerpts, exception messages or request bodies.
  const path = source.replaceAll("\\", "/").split(/[?#]/, 1)[0]!;
  const dependency = path.lastIndexOf("/node_modules/");
  const normalized = dependency >= 0 ? path.slice(dependency + 1)
    : path.startsWith("node_modules/") || path.startsWith("node:internal/") ? path
      : path.endsWith("/worker-build/index.js") ? "<worker-build>/index.js" : "<external source>";
  const safe = normalized === "<worker-build>/index.js"
    || /^(?:node_modules\/(?:wrangler\/wrangler-dist\/cli\.js|miniflare\/dist\/(?:src\/)?index\.js|esbuild\/lib\/main\.js)|node:internal\/[a-z0-9_./-]+)$/.test(normalized);
  return { source: safe && !normalized.split("/").includes("..") ? normalized.slice(0, 240) : "<external source>", line: Number(line), column: Number(column) };
}

/** An allowlist projection, not a general-purpose text redactor. Raw messages,
 * config, headers, URLs and authored rules never enter the returned record. */
export function extractWranglerFailure(raw: string) {
  const records = [...stripVTControlCharacters(raw).matchAll(/(?:^|\n)--- [\dT:.Z-]+ (debug|info|log|warn|error)\n([\s\S]*?)\n---(?:\n|$)/g)];
  const errors = records.filter((record) => record[1] === "error");
  const exceptions: Array<{ name: string; codes: string[]; stack: StackLocation[] }> = [];
  for (const record of records) {
    if (record[1] !== "debug" && record[1] !== "error") continue;
    const lines = record[2]!.trim().split("\n");
    const header = /^([A-Za-z][A-Za-z0-9_]*(?:Error|Exception)|Error)(?:\s+\[[A-Z0-9_]+\])?(?::|$)/.exec(lines[0] ?? "");
    if (!header) continue;
    const stack: StackLocation[] = [];
    for (const line of lines.slice(1)) {
      const location = /^\s+at (?:.*?\()?([^\s()]+):(\d+):(\d+)\)?\s*$/.exec(line);
      if (location) stack.push(stackLocation(location[1]!, location[2]!, location[3]!));
      if (stack.length === 12) break;
    }
    if (!stack.length) continue;
    exceptions.push({ name: ERROR_NAMES.has(header[1]!) ? header[1]! : "OtherError", codes: [...new Set((lines[0] ?? "").match(SYSTEM_CODES) ?? [])].slice(0, 8), stack });
  }
  return { errorRecords: errors.length, blankErrorRecords: errors.filter((record) => !record[2]!.replace(/✘ \[ERROR\]/g, "").trim()).length, exceptions: exceptions.slice(-4), messagesOmitted: true as const };
}

export async function readWranglerFailure(logPath: string) {
  try {
    const file = await open(logPath, "r");
    try {
      const size = (await file.stat()).size;
      const bytes = Buffer.alloc(Math.min(size, LOG_TAIL_BYTES));
      const read = await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
      return { logStatus: "available" as const, logBytes: size, tailBytes: read.bytesRead, tailLimited: size > LOG_TAIL_BYTES, ...extractWranglerFailure(bytes.subarray(0, read.bytesRead).toString("utf8")) };
    } finally { await file.close(); }
  } catch (error) {
    return { logStatus: error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing" as const : "unreadable" as const };
  }
}

export function parseProcessStatus(raw: string) {
  const value = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+)(?:\\s+kB)?$`, "m").exec(raw);
    return match ? Number(match[1]) : null;
  };
  const name = /^Name:\s+([^\n]+)$/m.exec(raw)?.[1];
  return { process: name && ["node", "workerd", "esbuild", "bun"].includes(name) ? name : "other", rssKiB: value("VmRSS"), peakKiB: value("VmHWM"), virtualPeakKiB: value("VmPeak"), threads: value("Threads") };
}

export function parseMemoryEvents(raw: string) {
  return Object.fromEntries(["low", "high", "max", "oom", "oom_kill", "oom_group_kill"].flatMap((key) => {
    const match = new RegExp(`^${key} (\\d+)$`, "m").exec(raw);
    return match ? [[key, Number(match[1])]] : [];
  })) as Record<string, number>;
}

async function optionalFile(path: string) { try { return await readFile(path, "utf8"); } catch { return ""; } }

/** Linux probes read numeric status/counter files only; never cmdline, environ,
 * argv, network state or a Node diagnostic report (which contains secrets). */
export async function captureServerResources(pid: number) {
  const processes: Array<ReturnType<typeof parseProcessStatus> & { pid: number }> = [];
  const seen = new Set<number>();
  async function visit(current: number) {
    if (seen.has(current) || seen.size >= 12 || !Number.isSafeInteger(current) || current <= 0) return;
    seen.add(current);
    const status = await optionalFile(`/proc/${current}/status`);
    if (!status) return;
    processes.push({ pid: current, ...parseProcessStatus(status) });
    const children = await optionalFile(`/proc/${current}/task/${current}/children`);
    for (const child of children.trim().split(/\s+/)) if (/^\d+$/.test(child)) await visit(Number(child));
  }
  await visit(pid);
  const group = /^0::(\/[^\n]*)$/m.exec(await optionalFile("/proc/self/cgroup"))?.[1];
  const groupPath = group && !group.split("/").includes("..") ? join("/sys/fs/cgroup", group) : "/sys/fs/cgroup";
  const events = await optionalFile(join(groupPath, "memory.events"));
  const current = (await optionalFile(join(groupPath, "memory.current"))).trim();
  const limit = (await optionalFile(join(groupPath, "memory.max"))).trim();
  return {
    at: new Date().toISOString(), hostFreeBytes: freemem(), hostTotalBytes: totalmem(), processes,
    cgroup: { scope: "shared-process-cgroup" as const, available: !!events, memoryBytes: /^\d+$/.test(current) ? Number(current) : null, memoryLimitBytes: /^\d+$/.test(limit) ? Number(limit) : null, events: parseMemoryEvents(events) },
  };
}
