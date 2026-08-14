import {
  DEFAULT_DEEPSEEK_MODEL,
  NUM,
  STR,
  buildRequest,
  dayKey,
  extractToolPayload,
  type DeepSeekTool,
} from "digipology-ai";
import {
  COVER_LAYOUTS,
  COVER_MOTIFS,
  TITLE_TREATMENTS,
  normalizeCoverSpec,
  renderCoverSvg,
  seededSpec,
  type CoverSpec,
} from "digipology-covers";
import type { AuthenticatedSession } from "./auth";
import type { D1Repositories } from "./d1-repositories";
import {
  configuredString,
  createMeteredDeepseekFetch,
  dailyCap,
  resolveDeepseekFetch,
  usageAtOrAboveCap,
  type AiGameDependencies,
} from "./ai-games";

const COVER_TOOL_NAME = "emit_cover_specs";

const enumString = (values: readonly string[], description: string) => ({
  ...STR(description),
  enum: [...values],
});

const strictObject = (properties: Record<string, unknown>, required: readonly string[]) => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

const coverSpecSchema = strictObject({
  palette: {
    type: "array",
    minItems: 2,
    maxItems: 4,
    items: { ...STR("A lowercase six-digit CSS hex color."), pattern: "^#[0-9a-f]{6}$" },
  },
  layout: enumString(COVER_LAYOUTS, "Geometric background composition."),
  motif: enumString(COVER_MOTIFS, "Tabletop glyph family rendered from pure shapes."),
  titleTreatment: enumString(TITLE_TREATMENTS, "Title typography composition."),
  seed: { ...NUM("Non-negative integer controlling deterministic layout jitter."), minimum: 0, multipleOf: 1 },
}, ["palette", "layout", "motif", "titleTreatment", "seed"]);

export const COVER_GENERATION_TOOL: DeepSeekTool = {
  type: "function",
  function: {
    name: COVER_TOOL_NAME,
    description: "Emit exactly four distinct Digipology CoverSpecs. Never emit SVG, images, URLs, fonts, or markup.",
    parameters: strictObject({
      candidates: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: coverSpecSchema,
      },
    }, ["candidates"]),
  },
};

export interface GenerateCoversResponse {
  source: "ai" | "procedural";
  candidates: Array<{ spec: CoverSpec; svg: string }>;
}

export interface CoverGenerationInput {
  env: Env;
  repositories: D1Repositories;
  session: AuthenticatedSession;
  slug: string;
  now: number;
  dependencies?: AiGameDependencies;
}

export async function handleCoverGeneration(input: CoverGenerationInput): Promise<Response> {
  const game = await input.repositories.getUploadedGame(input.slug);
  if (game === null) return jsonError(404, "not_found", "Game not found");
  if (game.ownerUserId !== input.session.user.id) {
    return jsonError(403, "forbidden", "Only the game owner can generate covers");
  }

  const fallback = proceduralResponse(input.slug, game.title, game.tagline);
  const deepseekFetch = resolveDeepseekFetch(input.env, input.dependencies);
  if (deepseekFetch === null) return jsonResponse(fallback);

  const day = dayKey(new Date(input.now));
  const cap = dailyCap(input.env);
  if (await usageAtOrAboveCap(input.env.DB, input.session.user.id, day, cap)) {
    return jsonResponse(fallback);
  }

  const metered = createMeteredDeepseekFetch({
    deepseekFetch,
    db: input.env.DB,
    userId: input.session.user.id,
    day,
    cap,
  });
  const modelResponse = await metered.fetch(buildCoverRequest(input.env, game.title, game.tagline), 30_000);
  if (modelResponse === null || metered.capReached()) return jsonResponse(fallback);

  const payload = extractToolPayload(modelResponse, asRecord);
  if (payload === null) return jsonResponse(fallback);
  const candidates = payload.candidates;
  if (!Array.isArray(candidates)) return jsonResponse(fallback);
  const specs = Array.from({ length: 4 }, (_, index) =>
    normalizeCoverSpec(candidates[index]) ?? seededSpec(`${input.slug}:cover-fallback:${index}`));
  return jsonResponse(renderResponse("ai", specs, game.title, game.tagline));
}

function buildCoverRequest(env: Env, title: string, tagline: string) {
  return buildRequest({
    model: configuredString(env, "DEEPSEEK_MODEL", DEFAULT_DEEPSEEK_MODEL),
    messages: [
      {
        role: "system",
        content: [
          "You are the packaging artist for a tabletop game platform.",
          "Use the forced tool only and emit exactly four visually distinct CoverSpecs.",
          "The renderer owns all SVG. Never emit SVG, markup, images, URLs, font names, gradients, or extra fields.",
          "Choose palettes with strong dark/light contrast and vary layout, motif, treatment, and seed across candidates.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Create four cover directions for this game context:\n${JSON.stringify({ title, tagline })}`,
      },
    ],
    tool: {
      name: COVER_GENERATION_TOOL.function.name,
      description: COVER_GENERATION_TOOL.function.description,
      properties: COVER_GENERATION_TOOL.function.parameters.properties as Record<string, unknown>,
      required: COVER_GENERATION_TOOL.function.parameters.required as string[],
    },
    maxTokens: 2_000,
    temperature: 0.8,
  });
}

function proceduralResponse(slug: string, title: string, tagline: string): GenerateCoversResponse {
  const specs = Array.from({ length: 4 }, (_, index) => seededSpec(`${slug}:cover:${index}`));
  return renderResponse("procedural", specs, title, tagline);
}

function renderResponse(
  source: GenerateCoversResponse["source"],
  specs: CoverSpec[],
  title: string,
  tagline: string,
): GenerateCoversResponse {
  return {
    source,
    candidates: specs.map((spec) => ({
      spec,
      svg: renderCoverSvg(spec, { title, tagline }),
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function jsonError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
