import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

describe("D1 migrations", () => {
  test("0002 applies after 0001 and preserves existing built-in rows", async () => {
    const db = new Database(":memory:");
    const base = await Bun.file(new URL("./0001_platform_v1.sql", import.meta.url)).text();
    const uploaded = await Bun.file(new URL("./0002_uploaded_games_v1.sql", import.meta.url)).text();
    db.exec(base);
    db.query(`INSERT INTO games
      (id, slug, title, tagline, min_players, max_players, builtin, latest_release_id, created_at, updated_at)
      VALUES ('game_builtin', 'builtin-test', 'Built in', '', 2, 4, 1, NULL, 1, 1)`).run();
    db.exec(uploaded);
    expect(db.query("SELECT slug, owner_user_id, visibility FROM games WHERE id = 'game_builtin'").get())
      .toEqual({ slug: "builtin-test", owner_user_id: null, visibility: "public" });
    expect(db.query("PRAGMA table_info(releases)").all().map((row) => (row as { name: string }).name))
      .toEqual(expect.arrayContaining(["bundle_key", "format_version", "network_protocol_version"]));
    expect(db.query("PRAGMA table_info(rate_limits)").all().map((row) => (row as { name: string }).name))
      .toContain("expires_at");
    db.close();
  });

  test("0003 applies after 0001 and 0002, preserves rows, and seeds metric homes", async () => {
    const db = new Database(":memory:");
    for (const name of [
      "0001_platform_v1.sql",
      "0002_uploaded_games_v1.sql",
    ]) db.exec(await Bun.file(new URL(`./${name}`, import.meta.url)).text());
    db.query(`INSERT INTO rooms_index
      (room_id, join_code, join_code_normalized, visibility, release_id,
       player_count, max_players, created_at, ended_at)
      VALUES ('room_legacy', 'AAAA-2222', 'AAAA2222', 'public',
              'builtin_first_deal_1', 2, 4, 1, NULL)`).run();
    db.exec(await Bun.file(new URL("./0003_quickplay_metrics_covers.sql", import.meta.url)).text());

    expect(db.query(`SELECT origin, last_heartbeat_at, game_slug
      FROM rooms_index WHERE room_id = 'room_legacy'`).get()).toEqual({
      origin: "hosted", last_heartbeat_at: null, game_slug: "first-deal",
    });
    expect(db.query(`SELECT slug, owner_user_id, visibility, total_plays, cover_version
      FROM games WHERE builtin = 1 ORDER BY slug`).all()).toEqual([
      { slug: "dice-dash", owner_user_id: null, visibility: "public", total_plays: 0, cover_version: 1 },
      { slug: "first-deal", owner_user_id: null, visibility: "public", total_plays: 0, cover_version: 1 },
    ]);
    db.close();
  });

  test("0004 adds per-user UTC-day DeepSeek usage after the existing migrations", async () => {
    const db = new Database(":memory:");
    for (const name of [
      "0001_platform_v1.sql",
      "0002_uploaded_games_v1.sql",
      "0003_quickplay_metrics_covers.sql",
      "0004_deepseek_usage.sql",
    ]) db.exec(await Bun.file(new URL(`./${name}`, import.meta.url)).text());
    db.query("INSERT INTO deepseek_usage (user_id, day, usd) VALUES (?, ?, ?)")
      .run("user_1", "2026-08-14", 0.25);
    expect(db.query("SELECT user_id, day, usd FROM deepseek_usage").get()).toEqual({
      user_id: "user_1", day: "2026-08-14", usd: 0.25,
    });
    expect(() => db.query("INSERT INTO deepseek_usage (user_id, day, usd) VALUES (?, ?, ?)")
      .run("user_1", "2026-08-14", 1)).toThrow();
    db.close();
  });

  test("0005 conservatively excludes existing rooms and allows explicit new lobbies", async () => {
    const db = new Database(":memory:");
    for (const name of [
      "0001_platform_v1.sql",
      "0002_uploaded_games_v1.sql",
      "0003_quickplay_metrics_covers.sql",
      "0004_deepseek_usage.sql",
    ]) db.exec(await Bun.file(new URL(`./${name}`, import.meta.url)).text());
    db.query(`INSERT INTO rooms_index
      (room_id, join_code, join_code_normalized, visibility, release_id,
       player_count, max_players, created_at, ended_at, origin,
       last_heartbeat_at, game_slug)
      VALUES ('room_residual', 'BBBB-2222', 'BBBB2222', 'public',
              'builtin_first_deal_1', 2, 4, 1, NULL, 'quickplay', 1, 'first-deal')`).run();
    db.exec(await Bun.file(new URL("./0005_room_joinability.sql", import.meta.url)).text());

    expect(db.query("SELECT joinable FROM rooms_index WHERE room_id = 'room_residual'").get())
      .toEqual({ joinable: 0 });
    db.query(`INSERT INTO rooms_index
      (room_id, join_code, join_code_normalized, visibility, release_id,
       player_count, max_players, created_at, ended_at, origin,
       last_heartbeat_at, game_slug, joinable)
      VALUES ('room_lobby', 'CCCC-2222', 'CCCC2222', 'public',
              'builtin_first_deal_1', 1, 4, 2, NULL, 'quickplay', 2, 'first-deal', 1)`).run();
    expect(db.query("SELECT room_id FROM rooms_index WHERE joinable = 1").all())
      .toEqual([{ room_id: "room_lobby" }]);
    db.close();
  });

  test("0006 adds saved tables and nullable room ownership/provenance", async () => {
    const db = new Database(":memory:");
    for (const name of [
      "0001_platform_v1.sql", "0002_uploaded_games_v1.sql",
      "0003_quickplay_metrics_covers.sql", "0004_deepseek_usage.sql",
      "0005_room_joinability.sql",
    ]) db.exec(await Bun.file(new URL(`./${name}`, import.meta.url)).text());
    db.query(`INSERT INTO rooms_index
      (room_id, join_code, join_code_normalized, visibility, release_id,
       player_count, max_players, created_at, origin, game_slug, joinable)
      VALUES ('legacy', 'DDDD-2222', 'DDDD2222', 'private',
       'builtin_first_deal_1', 1, 4, 1, 'hosted', 'first-deal', 0)`).run();
    db.exec(await Bun.file(new URL("./0006_saved_tables.sql", import.meta.url)).text());
    expect(db.query("SELECT creator_user_id, resumed_from_save_id FROM rooms_index WHERE room_id = 'legacy'").get())
      .toEqual({ creator_user_id: null, resumed_from_save_id: null });
    expect(db.query("PRAGMA table_info(saved_tables)").all().map((row) => (row as { name: string }).name))
      .toEqual(expect.arrayContaining(["owner_user_id", "release_id", "state_hash", "object_key", "deleted_at"]));
    db.close();
  });

  test("0006 applies as part of a fresh migration chain", async () => {
    const db = new Database(":memory:");
    for (const name of [
      "0001_platform_v1.sql", "0002_uploaded_games_v1.sql",
      "0003_quickplay_metrics_covers.sql", "0004_deepseek_usage.sql",
      "0005_room_joinability.sql", "0006_saved_tables.sql",
    ]) db.exec(await Bun.file(new URL(`./${name}`, import.meta.url)).text());
    db.query(`INSERT INTO users (id, name, email, created_at, updated_at)
      VALUES ('owner', 'Owner', 'owner@example.com', 1, 1)`).run();
    db.query(`INSERT INTO saved_tables
      (id, owner_user_id, release_id, game_slug, source_room_id, sequence,
       state_hash, object_key, byte_length, created_at)
      VALUES ('save_1', 'owner', 'builtin_first_deal_1', 'first-deal',
              'room_1', 7, 'sha256:test', 'saves/save_1.json', 100, 2)`).run();
    expect(db.query("SELECT owner_user_id, release_id, state_hash, object_key FROM saved_tables").get())
      .toEqual({
        owner_user_id: "owner",
        release_id: "builtin_first_deal_1",
        state_hash: "sha256:test",
        object_key: "saves/save_1.json",
      });
    db.close();
  });
});
