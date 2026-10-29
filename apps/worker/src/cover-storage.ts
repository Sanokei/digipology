import { hashValue, sha256 } from "digipology-canonical-json";
import { normalizeRasterArtworkInfo, type RasterArtworkInfo } from "digipology-protocol";

export interface StoredCover { version: number; asset_key: string; fingerprint: string | null; info_json: string | null }
export const coverByteHash = (bytes: Uint8Array) => `sha256:${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

export async function readStoredCover(db: D1Database, gameId: string, version: number, currentVersion: number): Promise<StoredCover | null> {
  try {
    return await db.prepare("SELECT version, asset_key, fingerprint, info_json FROM game_covers WHERE game_id = ? AND version = ?").bind(gameId, version).first<StoredCover>();
  } catch (error) {
    // Preserve existing covers while the new migration is being rolled out.
    // A legacy object only represents the current version; never invent history.
    if (error instanceof Error && error.message.includes("no such table: game_covers")) {
      return version === currentVersion ? { version, asset_key: `covers/${gameId}`, fingerprint: null, info_json: null } : null;
    }
    throw error;
  }
}

export function storedCoverInfo(record: StoredCover): RasterArtworkInfo | null {
  if (record.info_json === null) return null;
  try {
    const info = normalizeRasterArtworkInfo(JSON.parse(record.info_json));
    if (!info || hashValue(info) !== record.fingerprint) throw new Error();
    return info;
  } catch { throw new Error("Artwork information could not be read"); }
}

/** Immutable image bytes plus an atomic current-version/history update. */
export async function storeCover(
  db: D1Database, bucket: R2Bucket, gameId: string, ownerId: string,
  bytes: Uint8Array, info: RasterArtworkInfo, now: number,
): Promise<number> {
  const fingerprint = hashValue(info);
  const key = `covers/${gameId}/${fingerprint.slice(7)}`;
  await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: info.contentType } });
  const results = await db.batch<{ cover_version: number }>([
    db.prepare(`UPDATE games SET cover_version = COALESCE(cover_version, 0) + 1, updated_at = ?
      WHERE id = ? AND owner_user_id = ? AND builtin = 0 AND NOT EXISTS
      (SELECT 1 FROM game_covers c WHERE c.game_id = games.id AND c.version = games.cover_version AND c.fingerprint = ?)
      RETURNING cover_version`).bind(now, gameId, ownerId, fingerprint),
    db.prepare(`INSERT OR IGNORE INTO game_covers(game_id, version, asset_key, fingerprint, info_json, created_at)
      SELECT id, cover_version, ?, ?, ?, ? FROM games WHERE id = ? AND owner_user_id = ? AND builtin = 0`).bind(key, fingerprint, JSON.stringify(info), now, gameId, ownerId),
  ]);
  const changed = results[0]?.results[0]?.cover_version;
  if (typeof changed === "number") return changed;
  const existing = await db.prepare("SELECT version FROM game_covers WHERE game_id = ? AND fingerprint = ? ORDER BY version DESC LIMIT 1").bind(gameId, fingerprint).first<{ version: number }>();
  if (!existing) throw new Error("Artwork could not be saved");
  return existing.version;
}
