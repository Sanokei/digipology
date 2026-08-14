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
});

