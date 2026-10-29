import { authoringFromBundle } from "../apps/worker/src/ai-game-authoring";
import { builtinCatalog } from "../apps/worker/src/catalog";
import { createHash } from "node:crypto";
import { readRulebook, type GameArtDirection } from "digipology-protocol";
import { rasterPng } from "../packages/protocol/src/raster.fixture";
const coverByteHash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Hermetic HTTP ports. These are existing authored rules/raster fixtures, never live creative output. */
export function startGenerationFixture(port = 8795) {
  const author = (release: string) => {
    const source = builtinCatalog.getRelease(release)!.bundle;
    const draft = authoringFromBundle(source);
    const files = draft.files as Array<{ path: string; content: string }>;
    if (!files.some((file) => file.path === "runtime/rules.md")) files.push({ path: "runtime/rules.md", content: readRulebook(source)!.body });
    return draft;
  };
  const dice = author("builtin_dice_dash_3"), cards = author("builtin_first_deal_2");
  let generations = 0, repairs = 0, directions = 0;
  const imageRequests: Array<{ title: string; purpose: string; promptHash: string; source: string; sha256: string; fixture: true }> = [];
  const imageAttempts = new Map<string, number>();
  function direction(title: string, needsBack: boolean): GameArtDirection {
    const night = title.includes("Night");
    return { version: 1, style: `Transport fixture only: ${night ? "midnight blue botanical market" : "copper and ember merchant ledger"} illustration for ${title}.`,
      coverPrompt: `One ${night ? "moonlit market stall" : "merchant's alchemical ledger"} as a strong focal image for ${title}; no lettering or box mockup.`,
      cardBackPrompt: needsBack ? `${night ? "Moon and interwoven leaves" : "Copper seal and mirrored alembics"} in a 180-degree symmetric card-back motif for ${title}; safe edge, no text, ranks, suits or tiny cards.` : "" };
  }
  return Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/metrics") return Response.json({ fixture: true, generations, repairs, directions, imageRequests,
      scope: "Existing authored rules and authorized local raster input fixtures. HTTP transport/processing/persistence only; no live model generation or art-quality claim." });
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (path.endsWith("/images/generations")) {
      const body = await request.json() as { prompt: string };
      const title = /^Game: (.+)$/m.exec(body.prompt)?.[1] ?? "fixture";
      const purpose = /^Purpose: (.+)$/m.exec(body.prompt)?.[1] ?? "cover";
      const key = title + ":" + purpose + ":" + body.prompt;
      const attempt = (imageAttempts.get(key) ?? 0) + 1; imageAttempts.set(key, attempt);
      let bytes: Uint8Array, selected: string;
      if (body.prompt.includes("[blank-first]") && purpose === "card-back" && attempt === 1) {
        bytes = rasterPng(768, 1152, [255, 255, 255, 255]); selected = "intentional blank PNG admission fixture";
      } else {
        // Deliberately pre-existing fixtures. No production path selects these.
        const night = title.includes("Night");
        selected = purpose === "card-back" ? (night ? "zone-runner.webp" : "first-deal.webp") : (night ? "first-deal.webp" : "dice-dash.webp");
        bytes = new Uint8Array(await Bun.file(new URL(`../apps/web/public/art/${selected}`, import.meta.url)).arrayBuffer());
        selected = "apps/web/public/art/" + selected;
      }
      imageRequests.push({ title, purpose, promptHash: coverByteHash(new TextEncoder().encode(body.prompt)), source: selected, sha256: coverByteHash(bytes), fixture: true });
      return Response.json({ data: [{ b64_json: Buffer.from(bytes).toString("base64") }] });
    }
    if (!path.endsWith("/chat/completions")) return new Response("Not found", { status: 404 });
    const body = await request.json() as { messages: Array<{ role: string; content: string }> };
    if (body.messages.some((message) => message.content.includes("[provider-down]"))) return Response.json({ error: "Fixture provider unavailable" }, { status: 503 });
    if (body.messages[0]?.content.startsWith("Return one raw JSON object:")) {
      directions++;
      let title = "Fixture game";
      try { title = (JSON.parse(body.messages.at(-1)!.content) as { title: string }).title; } catch { /* fixture malformed request fallback */ }
      return Response.json({ choices: [{ message: { content: JSON.stringify(direction(title, true)) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
    }
    const repair = body.messages[0]?.content.includes("You are fixing a Digipology game draft");
    if (repair) repairs++; else generations++;
    const isCards = body.messages.some((message) => message.content.includes("[raster-cards-fixture]"));
    const night = body.messages.some((message) => message.content.includes("[night-art-fixture]"));
    const source = structuredClone(isCards ? cards : dice);
    if (isCards) source.title = night ? "Night Market transport" : "Ember Cards transport";
    source.tagline = isCards ? "Existing card rules with raster transport fixtures." : "Race your friends to twenty, one roll at a time.";
    source.artDirection = direction(String(source.title), isCards);
    if (body.messages.some((message) => message.content.includes("[blank-first]"))) (source.artDirection as GameArtDirection).cardBackPrompt += " [blank-first]";
    const files = source.files as Array<{ path: string; content: string }>;
    const broken = structuredClone(source);
    const firstScript = (broken.files as typeof files).find((file) => file.path.endsWith(".lua"))!;
    firstScript.content = isCards
      ? firstScript.content + '\nfunction on_start(ctx)\n error("deterministic fixture requires a repair")\nend'
      : 'function on_roll(ctx)\n error("deterministic fixture requires a repair")\nend';
    if (body.messages.some((message) => message.content.includes("[review-warning]"))) {
      broken.tagline = "A longer dice race for a test playthrough.";
      (broken.settings as Array<{ key: string; numberValue: number }>).find((setting) => setting.key === "targetScore")!.numberValue = 3_000;
      const guide = (broken.files as typeof files).find((file) => file.path === "runtime/rules.md")!;
      guide.content = guide.content.replaceAll("20", "3000");
      for (const entity of broken.entities as Array<{ id: string; components: Array<{ type: string; dataJson: string }> }>) {
        const counter = entity.components.find((component) => component.type === "counter");
        if (entity.id.startsWith("score_") && counter) counter.dataJson = JSON.stringify({ ...JSON.parse(counter.dataJson), max: 3_000 });
      }
    }
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(repair ? { files: files.filter((file) => file.path.endsWith(".lua")) } : broken) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  } });
}
