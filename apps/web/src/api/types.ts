import type { GameSnapshot } from "digipology-kernel";

// TODO: swap to digipology-protocol/http DTOs once the platform worker PR lands.
export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface GameDto {
  slug: string;
  title: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  builtin: boolean;
}

export interface ReleaseSummaryDto {
  releaseId: string;
  kernelVersion: number;
  luaApiVersion: number;
}

export interface RoomConnectionDto {
  roomId: string;
  joinCode: string;
  inviteUrl: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
}

export interface JoinRoomDto {
  roomId: string;
  playerId: string;
  roomToken: string;
  wsUrl: string;
  releaseId: string;
  joinCode?: string;
  inviteUrl?: string;
}

export interface PublicRoomDto {
  joinCode: string;
  gameTitle: string;
  players: number;
  maxPlayers: number;
  createdAt: string;
}

export interface ReleaseBundleDto {
  releaseId: string;
  title?: string;
  game?: { title?: string };
  snapshot?: GameSnapshot;
  initialSnapshot?: GameSnapshot;
  definitions?: Record<string, { label?: string; color?: string }>;
  [key: string]: unknown;
}

export type ApiErrorCode =
  | "not_found"
  | "full"
  | "ended"
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "network_error"
  | "invalid_response"
  | (string & {});

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  status?: number;
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiError };
