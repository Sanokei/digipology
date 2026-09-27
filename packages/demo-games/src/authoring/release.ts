import { canonicalStringify, hashValue, sha256 } from "digipology-canonical-json";
import { loadSnapshot, snapshot } from "digipology-kernel";
import type { BuiltinReleaseSource, MaterializedBuiltinRelease } from "./types";

type JsonObject = Record<string, unknown>;

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(
      0xe0 | (codePoint >>> 12),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
    else bytes.push(
      0xf0 | (codePoint >>> 18),
      0x80 | ((codePoint >>> 12) & 0x3f),
      0x80 | ((codePoint >>> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
  return Uint8Array.from(bytes);
}

function rawContentHash(content: string): string {
  let hex = "";
  for (const byte of sha256(encodeUtf8(content))) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}

function manifestInput(source: BuiltinReleaseSource, files: MaterializedBuiltinRelease["files"]): JsonObject {
  return {
    formatVersion: source.formatVersion,
    gameId: source.gameId,
    releaseId: source.releaseId,
    releaseNumber: source.releaseNumber,
    kernelVersion: source.kernelVersion,
    luaApiVersion: source.luaApiVersion,
    ...(source.luaStdlibVersion === undefined ? {} : { luaStdlibVersion: source.luaStdlibVersion }),
    networkProtocolVersion: source.networkProtocolVersion,
    interactionMode: source.interactionMode,
    minPlayers: source.minPlayers,
    maxPlayers: source.maxPlayers,
    files: files.map(({ path, contentHash, byteLength }) => ({ path, contentHash, byteLength })),
    ...(source.refs === undefined ? {} : { refs: source.refs }),
  } as JsonObject;
}

export function materializeBuiltinRelease(source: BuiltinReleaseSource): MaterializedBuiltinRelease {
  if (source.files.length < 1 || source.files.length > 256) {
    throw new RangeError("A builtin release must contain 1 to 256 files");
  }
  if (!Number.isSafeInteger(source.minPlayers) || !Number.isSafeInteger(source.maxPlayers) ||
      source.minPlayers < 1 || source.maxPlayers < source.minPlayers) {
    throw new RangeError("Builtin player limits are invalid");
  }
  if (source.initialState.releaseId !== source.releaseId || source.initialState.sequence !== 0) {
    throw new TypeError("A builtin initial state must be sequence zero and match its release ID");
  }
  const paths = new Set<string>();
  const files = source.files.map((file) => {
    if (!/^(?:runtime|scripts)\/[a-z0-9][a-z0-9._/-]{0,127}$/.test(file.path) ||
        file.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new TypeError(`Invalid release path: ${file.path}`);
    }
    if (paths.has(file.path)) throw new TypeError(`Duplicate release path: ${file.path}`);
    paths.add(file.path);
    const bytes = encodeUtf8(file.content);
    return {
      path: file.path,
      contentHash: rawContentHash(file.content),
      byteLength: bytes.length,
      content: file.content,
    };
  });
  const initialSnapshot = snapshot(source.initialState);
  loadSnapshot(initialSnapshot);
  const release: MaterializedBuiltinRelease = {
    formatVersion: source.formatVersion,
    gameId: source.gameId,
    releaseId: source.releaseId,
    releaseNumber: source.releaseNumber,
    kernelVersion: source.kernelVersion,
    luaApiVersion: source.luaApiVersion,
    ...(source.luaStdlibVersion === undefined ? {} : { luaStdlibVersion: source.luaStdlibVersion }),
    networkProtocolVersion: source.networkProtocolVersion,
    interactionMode: source.interactionMode,
    minPlayers: source.minPlayers,
    maxPlayers: source.maxPlayers,
    files,
    ...(source.definitions === undefined ? {} : { definitions: source.definitions }),
    ...(source.refs === undefined ? {} : { refs: source.refs }),
    integrity: { manifestHash: hashValue(manifestInput(source, files)) },
    initialSnapshot,
  };
  canonicalStringify(release);
  return release;
}
