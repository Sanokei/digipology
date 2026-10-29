import { sha256 } from "digipology-canonical-json";
import { parseSoundBundle as parse, soundHash as hash } from "digipology-protocol";

export const parseSoundBundle = (content: string) => parse(content, sha256);
export const soundHash = (bytes: Uint8Array) => hash(bytes, sha256);
