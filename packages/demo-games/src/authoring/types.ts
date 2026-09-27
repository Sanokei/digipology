import type { CanonicalGameState } from "digipology-kernel";
import type {
  InteractionMode,
  PresentationDefinitions,
  ReleaseBundle,
} from "../types";

export interface AuthoredReleaseFile {
  readonly path: string;
  readonly content: string;
}

export interface BuiltinReleaseSource {
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
  readonly files: ReadonlyArray<AuthoredReleaseFile>;
  readonly definitions?: PresentationDefinitions;
  readonly refs?: Readonly<Record<string, string>>;
  readonly initialState: CanonicalGameState;
}

export interface BuiltinReleaseBuilder {
  readonly slug: string;
  readonly releaseNumber: number;
  readonly build: () => BuiltinReleaseSource;
}

export type MaterializedBuiltinRelease = ReleaseBundle & {
  readonly initialSnapshot: NonNullable<ReleaseBundle["initialSnapshot"]>;
};
