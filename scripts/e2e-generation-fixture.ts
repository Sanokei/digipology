import { authoringFromBundle } from "../apps/worker/src/ai-game-authoring";
import { builtinCatalog } from "../apps/worker/src/catalog";
import { readRulebook } from "digipology-protocol";

/** Deterministic test boundary. This is deliberately not a live model provider. */
export function startGenerationFixture(port = 8795) {
  const source = builtinCatalog.getRelease("builtin_dice_dash_3")!.bundle;
  const authoring = authoringFromBundle(source);
  const files = authoring.files as Array<{ path: string; content: string }>;
  files.push({ path: "runtime/rules.md", content: readRulebook(source)!.body });
  const broken = structuredClone(authoring);
  (broken.files as typeof files).find((file) => file.path.endsWith(".lua"))!.content = 'function on_roll(ctx)\n error("deterministic fixture requires a repair")\nend';
  let generations = 0, repairs = 0;
  return Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
    if (new URL(request.url).pathname === "/metrics") return Response.json({ fixture: true, generations, repairs });
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions")) return new Response("Not found", { status: 404 });
    const body = await request.json() as { messages: Array<{ role: string; content: string }> };
    if (body.messages.some((message) => message.content.includes("[provider-down]"))) return Response.json({ error: "Fixture provider unavailable" }, { status: 503 });
    const repair = body.messages[0]?.content.includes("You are fixing a Digipology game draft");
    if (repair) repairs += 1; else generations += 1;
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(repair ? { files: files.filter((file) => file.path.endsWith(".lua")) } : broken) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  } });
}
