import { afterEach, describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { responseUsd, type DeepseekFetch, type DeepSeekRequest } from "digipology-ai";
import type { ReleaseBundleDto } from "digipology-protocol/http";
import { createSession } from "./auth";
import { builtinCatalog } from "./catalog";
import { D1Repositories } from "./d1-repositories";
import { handlePlatformRequest } from "./platform";
import { prepareUploadedBundle } from "./release-validation";
import {
  AI_GAME_TOOL,
  assembleAiGameDraft,
  authoringFromBundle,
} from "./ai-games";

const NOW = Date.UTC(2026, 7, 14, 12);
const SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
const CSRF = { "X-Digipology-CSRF": "1", "Content-Type": "application/json" };
const openDatabases: Database[] = [];

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close();
});

describe("AI game authoring schema and assembly", () => {
  test("a real demo game's authorable fields satisfy the forced tool JSON schema", () => {
    const bundle = builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle;
    const authoring = authoringFromBundle(bundle);
    expect(schemaProblems(authoring, AI_GAME_TOOL.function.parameters)).toEqual([]);
    expect(JSON.stringify(AI_GAME_TOOL)).not.toContain("contentHash");
    expect(JSON.stringify(AI_GAME_TOOL)).not.toContain("manifestHash");
    expect(JSON.stringify(AI_GAME_TOOL)).not.toContain("initialSnapshot");
    expect(AI_GAME_TOOL.function.parameters).toMatchObject({ additionalProperties: false });
  });

  test("computes every integrity field and passes the existing eight-check validator", () => {
    const source = builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle;
    const result = assembleAiGameDraft(authoringFromBundle(source));
    expect(result.draft).not.toBeNull();
    expect(result.report).toHaveLength(8);
    expect(result.report.every((item) => item.ok)).toBe(true);
    expect(result.draft?.files.every((file) =>
      /^sha256:[0-9a-f]{64}$/.test(file.contentHash) &&
      file.byteLength === new TextEncoder().encode(file.content).byteLength)).toBe(true);
    expect(result.draft?.integrity.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.draft?.initialSnapshot.stateHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("turns unregistered components and action references into typed checks", () => {
    const source = builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle;
    const componentPayload = authoringFromBundle(source);
    const entities = componentPayload.entities as Array<{ components: Array<Record<string, unknown>> }>;
    entities[0]!.components[0]!.type = "renderer-mesh";
    expect(assembleAiGameDraft(componentPayload).report.find((item) => item.check === "bundle_shape"))
      .toMatchObject({ ok: false, detail: expect.stringContaining("unregistered") });

    const actionPayload = authoringFromBundle(source);
    (actionPayload.files as Array<{ content: string }>)[0]!.content += '\n{"type":"deck.teleport"}';
    expect(assembleAiGameDraft(actionPayload).report.find((item) => item.check === "bundle_shape"))
      .toMatchObject({ ok: false, detail: "unregistered action deck.teleport" });
  });
});

describe("AI game route matrices", () => {
  for (const route of ["create", "edit"] as const) {
    test(`${route}: requires a session before checking AI configuration`, async () => {
      const response = await requestRoute(route, {} as Env, null, async () => validModelResponse());
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "authentication_required" } });
    });

    test(`${route}: keyless is a calm 503`, async () => {
      const fixture = await routeFixture();
      const response = await requestRoute(route, fixture.env, fixture.cookie, null);
      expect(response.status).toBe(503);
      expect(await response.json() as unknown).toEqual({
        error: { code: "ai_unconfigured", message: "AI creation isn't set up on this server yet" },
      });
    });

    test(`${route}: rejects the cap boundary before the model`, async () => {
      const fixture = await routeFixture();
      fixture.db.query("INSERT INTO deepseek_usage (user_id, day, usd) VALUES (?, ?, ?)")
        .run("user_owner", "2026-08-14", 1);
      let calls = 0;
      const response = await requestRoute(route, fixture.env, fixture.cookie, async () => {
        calls += 1;
        return validModelResponse();
      });
      expect(response.status).toBe(429);
      expect(calls).toBe(0);
      expect(await response.json()).toMatchObject({ error: { code: "ai_daily_cap" } });
    });

    test(`${route}: returns a validated draft without persisting it`, async () => {
      const fixture = await routeFixture();
      const before = databaseCounts(fixture.db);
      const response = await requestRoute(route, fixture.env, fixture.cookie, async () => validModelResponse());
      expect(response.status).toBe(200);
      const body = await response.json() as {
        draft: ReleaseBundleDto;
        validationReport: Array<{ ok: boolean }>;
        telemetry: { attempts: number; firstTryValid: boolean };
      };
      expect(body.validationReport).toHaveLength(8);
      expect(body.validationReport.every((item) => item.ok)).toBe(true);
      expect(body.telemetry).toMatchObject({ attempts: 1, firstTryValid: true });
      expect(databaseCounts(fixture.db)).toEqual(before);
      expect(fixture.r2Puts).toBe(0);
      if (route === "edit") {
        expect(fixture.r2Gets).toEqual(["releases/release_owned.json"]);
        expect(body.draft).toMatchObject({ gameId: "game_owned", releaseNumber: 2 });
      }
    });

    test(`${route}: three invalid drafts return 502 and typed feedback`, async () => {
      const fixture = await routeFixture();
      const requests: DeepSeekRequest[] = [];
      const invalid = authoringFromBundle(builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle);
      (invalid.files as Array<{ content: string }>)[0]!.content += '\n{"type":"deck.teleport"}';
      const response = await requestRoute(route, fixture.env, fixture.cookie, async (payload) => {
        requests.push(payload);
        return modelResponse(invalid);
      });
      expect(response.status).toBe(502);
      const body = await response.json() as {
        error: { code: string };
        validationReport: Array<{ check: string; ok: boolean }>;
        telemetry: { attempts: number; retries: number };
      };
      expect(body.error.code).toBe("ai_generation_failed");
      expect(body.telemetry).toMatchObject({ attempts: 3, retries: 2 });
      expect(body.validationReport).toContainEqual(expect.objectContaining({ check: "bundle_shape", ok: false }));
      expect(requests).toHaveLength(3);
      expect(requests[1]?.messages.at(-1)?.content).toContain("[bundle_shape]");
    });
  }

  test("edit rejects a signed-in non-owner before keyless/model checks", async () => {
    const fixture = await routeFixture("user_other");
    const response = await requestRoute("edit", fixture.env, fixture.cookie, null);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("forces the source-derived function tool and never sends response_format", async () => {
    const fixture = await routeFixture();
    let captured: DeepSeekRequest | null = null;
    const response = await requestRoute("create", fixture.env, fixture.cookie, async (payload) => {
      captured = payload;
      return validModelResponse();
    });
    expect(response.status).toBe(200);
    const request = captured! as DeepSeekRequest;
    expect(request.model).toBe("deepseek-v4-flash");
    expect(request.tool_choice).toEqual({ type: "function", function: { name: "emit_game_bundle_draft" } });
    expect(request.tools[0]?.function.parameters).toMatchObject({ additionalProperties: false });
    expect(request.messages[0]?.content).toContain("deck.draw_to_container");
    expect(request.messages[0]?.content).toContain("snap-point (requires transform)");
    expect(request.messages[0]?.content).toContain("math.random and math.randomseed are removed");
    expect(JSON.stringify(request)).not.toContain("response_format");
  });
});

describe("AI game budgets", () => {
  test("records response cost before failed extraction and accumulates all attempts", async () => {
    const fixture = await routeFixture();
    const unextractable = { choices: [{ message: { content: "no tool object" } }], usage: {
      prompt_tokens: 1_000, completion_tokens: 1_000,
    } };
    const response = await requestRoute("create", fixture.env, fixture.cookie, async () => unextractable);
    expect(response.status).toBe(502);
    const row = fixture.db.query("SELECT day, usd FROM deepseek_usage WHERE user_id = ?")
      .get("user_owner") as { day: string; usd: number };
    expect(row.day).toBe("2026-08-14");
    expect(row.usd).toBeCloseTo(responseUsd(unextractable) * 3, 12);
  });

  test("allows just under the cap and then records the completed call", async () => {
    const fixture = await routeFixture();
    fixture.db.query("INSERT INTO deepseek_usage (user_id, day, usd) VALUES (?, ?, ?)")
      .run("user_owner", "2026-08-14", 0.999999);
    let calls = 0;
    const response = await requestRoute("create", fixture.env, fixture.cookie, async () => {
      calls += 1;
      return validModelResponse();
    });
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    const usd = (fixture.db.query("SELECT usd FROM deepseek_usage WHERE user_id = ? AND day = ?")
      .get("user_owner", "2026-08-14") as { usd: number }).usd;
    expect(usd).toBeGreaterThan(0.999999);
  });

  test("feeds a typed violation to attempt two and meters both calls", async () => {
    const fixture = await routeFixture();
    const captured: DeepSeekRequest[] = [];
    const invalid = authoringFromBundle(builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle);
    (invalid.files as Array<{ content: string }>)[0]!.content += '\n{"type":"counter.multiply"}';
    const valid = authoringFromBundle(builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle);
    const responseTemplate = validModelResponse();
    const response = await requestRoute("create", fixture.env, fixture.cookie, async (payload) => {
      captured.push(payload);
      return captured.length === 1 ? modelResponse(invalid) : responseTemplate;
    });
    expect(response.status).toBe(200);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.messages.at(-1)?.content).toContain("counter.multiply");
    const usd = (fixture.db.query("SELECT usd FROM deepseek_usage WHERE user_id = ?")
      .get("user_owner") as { usd: number }).usd;
    expect(usd).toBeCloseTo(responseUsd(modelResponse(invalid)) + responseUsd(responseTemplate), 12);
  });

  test("rechecks the cap between validator-loop attempts", async () => {
    const fixture = await routeFixture();
    Object.assign(fixture.env, { AI_DAILY_USD_CAP: "0.001" });
    let calls = 0;
    const costlyInvalid = {
      choices: [{ message: { content: "unextractable" } }],
      usage: { prompt_tokens: 1_000, completion_tokens: 1_000 },
    };
    const response = await requestRoute("create", fixture.env, fixture.cookie, async () => {
      calls += 1;
      return costlyInvalid;
    });
    expect(response.status).toBe(429);
    expect(calls).toBe(1);
    expect((fixture.db.query("SELECT usd FROM deepseek_usage WHERE user_id = ?")
      .get("user_owner") as { usd: number }).usd).toBeCloseTo(responseUsd(costlyInvalid), 12);
  });
});

interface RouteFixture {
  db: Database;
  env: Env;
  cookie: string;
  r2Gets: string[];
  r2Puts: number;
}

async function routeFixture(sessionUser = "user_owner"): Promise<RouteFixture> {
  const db = new Database(":memory:");
  openDatabases.push(db);
  for (const name of [
    "0001_platform_v1.sql", "0002_uploaded_games_v1.sql",
    "0003_quickplay_metrics_covers.sql", "0004_deepseek_usage.sql",
  ]) db.exec(await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text());
  db.query("INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("user_owner", "Owner", "owner@example.com", NOW, NOW);
  db.query("INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("user_other", "Other", "other@example.com", NOW, NOW);
  db.query(`INSERT INTO games
    (id, slug, title, tagline, min_players, max_players, builtin, latest_release_id,
     created_at, updated_at, owner_user_id, visibility, total_plays, cover_version)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'public', 0, NULL)`)
    .run("game_owned", "owned-game", "Owned Game", "Existing tagline", 2, 4,
      "release_owned", NOW, NOW, "user_owner");
  const source = builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle;
  const prepared = prepareUploadedBundle(source, {
    gameId: "game_owned", releaseId: "release_owned", releaseNumber: 1, title: "Owned Game",
  });
  db.query(`INSERT INTO releases
    (id, game_id, release_number, kernel_version, lua_api_version, manifest_hash,
     status, created_at, format_version, network_protocol_version, bundle_key)
    VALUES (?, ?, 1, 1, 1, ?, 'ready', ?, 1, 1, ?)`)
    .run("release_owned", "game_owned", prepared.bundle.integrity.manifestHash, NOW,
      "releases/release_owned.json");

  const d1 = sqliteD1(db);
  const repositories = new D1Repositories(d1);
  const session = await createSession(repositories, {
    id: sessionUser,
    name: sessionUser === "user_owner" ? "Owner" : "Other",
    email: sessionUser === "user_owner" ? "owner@example.com" : "other@example.com",
  }, SESSION_SECRET, NOW);
  const r2Gets: string[] = [];
  const state = { puts: 0 };
  const releases = {
    async get(key: string) {
      r2Gets.push(key);
      if (key !== "releases/release_owned.json") return null;
      return {
        async json<T>() { return structuredClone(prepared.bundle) as T; },
      };
    },
    async put() { state.puts += 1; return {}; },
  } as unknown as R2Bucket;
  return {
    db,
    env: {
      DB: d1,
      RELEASES: releases,
      SESSION_SECRET,
      AI_DAILY_USD_CAP: "1",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
    } as unknown as Env,
    cookie: `dgp_session=${session.token}`,
    r2Gets,
    get r2Puts() { return state.puts; },
  };
}

async function requestRoute(
  route: "create" | "edit",
  env: Env,
  cookie: string | null,
  fetch: DeepseekFetch | null,
): Promise<Response> {
  const path = route === "create" ? "/api/ai/games" : "/api/ai/games/owned-game/edit";
  const headers = new Headers(CSRF);
  if (cookie !== null) headers.set("Cookie", cookie);
  return handlePlatformRequest(new Request(`https://play.digipology.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(route === "create" ? { prompt: "Make a quick dice game" } : { instruction: "Make scoring clearer" }),
  }), env, { deepseekFetch: fetch, now: NOW });
}

function validModelResponse(): unknown {
  return modelResponse(authoringFromBundle(builtinCatalog.getRelease("builtin_dice_dash_2")!.bundle));
}

function modelResponse(authoring: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(authoring) } }] } }],
    usage: { prompt_tokens: 1_000, completion_tokens: 1_000 },
  };
}

function databaseCounts(db: Database): { games: number; releases: number } {
  return {
    games: (db.query("SELECT COUNT(*) AS count FROM games").get() as { count: number }).count,
    releases: (db.query("SELECT COUNT(*) AS count FROM releases").get() as { count: number }).count,
  };
}

class SqliteD1Statement {
  constructor(
    readonly database: Database,
    readonly sql: string,
    readonly values: SQLQueryBindings[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(
      this.database,
      this.sql,
      values as SQLQueryBindings[],
    ) as unknown as D1PreparedStatement;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.query(this.sql).get(...this.values) as T | null) ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return result(this.database.query(this.sql).all(...this.values) as T[]);
  }

  async run<T>(): Promise<D1Result<T>> {
    if (/\bRETURNING\b/i.test(this.sql)) {
      return result(this.database.query(this.sql).all(...this.values) as T[]);
    }
    const executed = this.database.query(this.sql).run(...this.values);
    return {
      success: true,
      meta: d1Meta(executed.changes),
      results: [],
    };
  }
}

function sqliteD1(database: Database): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql) as unknown as D1PreparedStatement;
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      database.transaction(() => {
        for (const statement of statements) {
          const sqlite = statement as unknown as SqliteD1Statement;
          if (/\bRETURNING\b/i.test(sqlite.sql)) {
            results.push(result(database.query(sqlite.sql).all(...sqlite.values) as T[]));
          } else {
            const executed = database.query(sqlite.sql).run(...sqlite.values);
            results.push({ success: true, meta: d1Meta(executed.changes), results: [] });
          }
        }
      })();
      return results;
    },
  } as unknown as D1Database;
}

function result<T>(results: T[]): D1Result<T> {
  return { success: true, meta: d1Meta(results.length), results };
}

function d1Meta(changes: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  };
}

function schemaProblems(value: unknown, schema: unknown, path = "$"): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return [`${path}: invalid schema`];
  const rule = schema as Record<string, unknown>;
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return [`${path}: not in enum`];
  if (rule.type === "string") return typeof value === "string" ? [] : [`${path}: expected string`];
  if (rule.type === "number") return typeof value === "number" && Number.isFinite(value) ? [] : [`${path}: expected number`];
  if (rule.type === "boolean") return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
  if (rule.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (typeof rule.minItems === "number" && value.length < rule.minItems) return [`${path}: too short`];
    if (typeof rule.maxItems === "number" && value.length > rule.maxItems) return [`${path}: too long`];
    return value.flatMap((item, index) => schemaProblems(item, rule.items, `${path}[${index}]`));
  }
  if (rule.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: expected object`];
    const record = value as Record<string, unknown>;
    const properties = rule.properties as Record<string, unknown>;
    const required = rule.required as string[];
    const problems = required.filter((key) => !(key in record)).map((key) => `${path}.${key}: required`);
    if (rule.additionalProperties === false) {
      problems.push(...Object.keys(record).filter((key) => !(key in properties)).map((key) => `${path}.${key}: unknown`));
    }
    for (const key of Object.keys(record)) {
      if (key in properties) problems.push(...schemaProblems(record[key], properties[key], `${path}.${key}`));
    }
    return problems;
  }
  return [];
}
