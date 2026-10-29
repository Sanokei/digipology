import type { QualityIssue } from "digipology-ai";
import type { ReleaseBundleDto } from "digipology-protocol/http";

export type DraftQualityCheck = (draft: ReleaseBundleDto) => Promise<QualityIssue[]>;

/** WASM playtesting runs in the Bun harness, outside the Worker and Room DO. */
export function resolveQualityCheck(env: object): DraftQualityCheck | null {
  const configured = Reflect.get(env, "AI_QUALITY_BASE_URL");
  if (typeof configured !== "string" || !configured.trim()) return null;
  const base = new URL(configured);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))) || base.username || base.password) throw new Error("The quality harness requires HTTPS or local loopback");
  const token = Reflect.get(env, "AI_QUALITY_TOKEN");
  return async (draft) => {
    const response = await fetch(new URL("check", base.href.replace(/\/?$/, "/")), {
      method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", ...(typeof token === "string" && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ draft }),
    });
    if (!response.ok) throw new Error(`Game playtesting is temporarily unavailable (${response.status})`);
    const body: unknown = await response.json();
    const issues = typeof body === "object" && body !== null ? Reflect.get(body, "issues") : null;
    if (!Array.isArray(issues) || issues.length > 256 || issues.some((issue) => !issue || typeof issue.code !== "string" || typeof issue.message !== "string" || !["warning", "error"].includes(issue.severity))) throw new Error("The playtest harness returned an invalid report");
    return issues as QualityIssue[];
  };
}
