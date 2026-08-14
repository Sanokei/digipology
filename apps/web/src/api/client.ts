import type {
  ApiError,
  ApiResult,
  AiGameDraftResponse,
  CreateGameRequest,
  CreateGameResponse,
  CreateReleaseResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  GameResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  MeResponse,
  MyGamesResponse,
  PublicRoomDto,
  ReleaseBundleDto,
  UpdateGameResponse,
  UserDto,
  UserResponse,
} from "digipology-protocol/http";
import { CSRF_HEADER } from "digipology-protocol/http";
import type { CatalogGamesResponse, QuickPlayRequest, QuickPlayResponse } from "./quickplayAdapter";

export { CSRF_HEADER } from "digipology-protocol/http";
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ApiClient {
  requestLink(email: string): Promise<ApiResult<void>>;
  logout(): Promise<ApiResult<void>>;
  me(): Promise<ApiResult<MeResponse>>;
  patchMe(name: string): Promise<ApiResult<UserResponse>>;
  listGames(): Promise<ApiResult<CatalogGamesResponse>>;
  getGame(slug: string): Promise<ApiResult<GameResponse>>;
  listMyGames(): Promise<ApiResult<MyGamesResponse>>;
  createGame(input: CreateGameRequest): Promise<ApiResult<CreateGameResponse>>;
  createRelease(slug: string, bundle: ReleaseBundleDto): Promise<ApiResult<CreateReleaseResponse>>;
  createAiGame(prompt: string): Promise<ApiResult<AiGameDraftResponse>>;
  editAiGame(slug: string, instruction: string): Promise<ApiResult<AiGameDraftResponse>>;
  updateGameVisibility(slug: string, visibility: "public" | "unlisted"): Promise<ApiResult<UpdateGameResponse>>;
  createRoom(input: CreateRoomRequest): Promise<ApiResult<CreateRoomResponse>>;
  joinRoom(input: JoinRoomRequest): Promise<ApiResult<JoinRoomResponse>>;
  quickPlay(input: QuickPlayRequest): Promise<ApiResult<QuickPlayResponse>>;
  listPublicRooms(): Promise<ApiResult<{ rooms: PublicRoomDto[] }>>;
  getReleaseBundle(id: string): Promise<ApiResult<ReleaseBundleDto>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapError(value: unknown, status?: number): ApiError {
  if (isRecord(value) && isRecord(value.error)) {
    const code = value.error.code;
    const message = value.error.message;
    if (typeof code === "string" && typeof message === "string") {
      const mapped: ApiError = {
        code,
        message,
        ...(status === undefined ? {} : { status }),
      };
      const report = Array.isArray(value.report) ? value.report : value.validationReport;
      if (Array.isArray(report)) mapped.report = report as NonNullable<ApiError["report"]>;
      return mapped;
    }
  }
  return {
    code: "invalid_response",
    message: status === undefined
      ? "The server returned an unreadable response."
      : `The server returned an unreadable response (${status}).`,
    ...(status === undefined ? {} : { status }),
  };
}

export function createApiClient(fetcher: Fetcher = fetch): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    if (method !== "GET") headers.set(CSRF_HEADER, "1");
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetcher(path, { ...init, method, headers, credentials: "include" });
    } catch {
      return { ok: false, error: { code: "network_error", message: "Could not reach Digipology. Check your connection and try again." } };
    }

    if (response.status === 204) {
      return response.ok
        ? { ok: true, value: undefined as T }
        : { ok: false, error: { code: "invalid_response", message: "The request failed.", status: response.status } };
    }

    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      return { ok: false, error: mapError(undefined, response.status) };
    }
    return response.ok
      ? { ok: true, value: body as T }
      : { ok: false, error: mapError(body, response.status) };
  }

  const post = <T>(path: string, body?: unknown) => request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return {
    requestLink: (email) => post<void>("/api/auth/request-link", { email }),
    logout: () => post<void>("/api/auth/logout"),
    me: () => request("/api/me"),
    patchMe: (name) => request("/api/me", { method: "PATCH", body: JSON.stringify({ name }) }),
    listGames: () => request("/api/games"),
    getGame: (slug) => request(`/api/games/${encodeURIComponent(slug)}`),
    listMyGames: () => request("/api/games/mine"),
    createGame: (input) => post("/api/games", input),
    createRelease: (slug, bundle) => post(`/api/games/${encodeURIComponent(slug)}/releases`, { bundle }),
    createAiGame: (prompt) => post("/api/ai/games", { prompt }),
    editAiGame: (slug, instruction) => post(`/api/ai/games/${encodeURIComponent(slug)}/edit`, { instruction }),
    updateGameVisibility: (slug, visibility) => request(`/api/games/${encodeURIComponent(slug)}`, {
      method: "PATCH", body: JSON.stringify({ visibility }),
    }),
    createRoom: (input) => post("/api/rooms", input),
    joinRoom: (input) => post("/api/rooms/join", input),
    quickPlay: (input) => post("/api/quickplay", input),
    listPublicRooms: () => request("/api/rooms/public"),
    getReleaseBundle: (id) => request(`/api/releases/${encodeURIComponent(id)}/bundle`),
  };
}

export const api = createApiClient();
