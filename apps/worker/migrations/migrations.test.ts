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
});
