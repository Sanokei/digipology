import { checkDraftQuality, type DraftSimulationReport } from "../apps/worker/src/ai-game-quality";
import { validateUploadedBundle } from "../apps/worker/src/release-validation";
import type { ReleaseBundleDto } from "digipology-protocol/http";

export function startQualityServer(options: { port?: number; hostname?: string; token?: string } = {}) {
  const hostname = options.hostname ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname) && !options.token) throw new Error("A public quality harness requires an authentication token");
  let running = 0;
  return Bun.serve({
    hostname, port: options.port ?? 8798, idleTimeout: 40,
    maxRequestBodySize: 2 * 1024 * 1024,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") return Response.json({ status: "ok", service: "digipology-playtesting" });
      if (url.pathname !== "/check" || request.method !== "POST") return new Response("Not found", { status: 404 });
      if (options.token && request.headers.get("Authorization") !== `Bearer ${options.token}`) return new Response("Unauthorized", { status: 401 });
      if (running >= 2) return new Response("Playtesting is busy", { status: 429, headers: { "Retry-After": "5" } });
      let draft: ReleaseBundleDto;
      let requireRules = false;
      try {
        const body = await request.json() as { draft?: ReleaseBundleDto; requireRules?: boolean };
        if (!body.draft || !validateUploadedBundle(body.draft, body.draft.minPlayers, body.draft.maxPlayers).every((item) => item.ok)) return Response.json({ error: "Invalid game bundle" }, { status: 400 });
        draft = body.draft;
        requireRules = body.requireRules === true;
      } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
      running += 1;
      try {
        let simulation: DraftSimulationReport | undefined;
        const issues = await checkDraftQuality(draft, { simulateRolls: 24, instructionBudget: 100_000, requireRules, onSimulation: (report) => { simulation = report; } });
        return Response.json({ issues, simulation }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ error: "The game could not be playtested" }, { status: 422 });
      } finally { running -= 1; }
    },
  });
}

if (import.meta.main) {
  const server = startQualityServer({
    port: Number(Bun.env.QUALITY_HARNESS_PORT ?? "8798"), hostname: Bun.env.QUALITY_HARNESS_HOST ?? "127.0.0.1",
    ...(Bun.env.AI_QUALITY_TOKEN ? { token: Bun.env.AI_QUALITY_TOKEN } : {}),
  });
  console.log(`Game playtest harness listening on port ${server.port}`);
  const stop = () => { void server.stop(true); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
