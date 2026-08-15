export type InteractionMode = "sandbox" | "scripted";

export interface ReleaseFile {
  readonly path: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly content: string;
}

export interface ReleaseIntegrity {
  readonly manifestHash: string;
}

/**
 * Appendix D.2 release manifest fields with immutable file contents inlined for
 * the built-in serving path. File content is excluded from the manifest hash;
 * each contentHash covers the corresponding raw UTF-8 bytes.
 */
export interface ReleaseBundle {
  readonly formatVersion: 1;
  readonly gameId: string;
  readonly releaseId: string;
  readonly releaseNumber: number;
  readonly kernelVersion: 1;
  readonly luaApiVersion: 1;
  readonly luaStdlibVersion?: 1;
  readonly networkProtocolVersion: 1;
  readonly interactionMode: InteractionMode;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly files: ReadonlyArray<ReleaseFile>;
  readonly definitions?: Readonly<Record<string, { readonly label?: string; readonly color?: string }>>;
  readonly refs?: Readonly<Record<string, string>>;
  readonly integrity: ReleaseIntegrity;
}

export interface BuiltinGame {
  readonly slug: string;
  readonly title: string;
  readonly tagline: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly latestReleaseId: string;
  readonly releases: ReadonlyArray<ReleaseBundle>;
}
