import type { AuthResponse } from "./types.ts";

type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | undefined;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

type RequestOptions = {
  body?: unknown;
  /** Send the access token and retry once after refreshing it on a 401. Default: true. */
  auth?: boolean;
};

export type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Small fetch wrapper for the backend API.
 *
 * - The access token lives only in memory; the refresh token is an HttpOnly cookie.
 * - A 401 on an authenticated call triggers one (de-duplicated) refresh and one retry.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/api/v1";
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args));

  let accessToken: string | null = null;
  let refreshing: Promise<AuthResponse | null> | null = null;
  let sessionLostHandler: (() => void) | null = null;

  async function send(
    method: string,
    path: string,
    requestOptions: RequestOptions,
    token: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    let body: string | undefined;

    if (requestOptions.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(requestOptions.body);
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      return await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: "include",
        ...(body !== undefined ? { body } : {}),
      });
    } catch {
      throw new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "Could not reach the server.",
      });
    }
  }

  async function parse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const error = (data as ApiErrorBody | null)?.error;

      throw new ApiError({
        status: response.status,
        code: error?.code ?? "HTTP_ERROR",
        message: error?.message ?? (response.statusText || "Request failed."),
        details: error?.details,
        requestId: error?.requestId,
      });
    }

    return data as T;
  }

  function refreshSession(): Promise<AuthResponse | null> {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const response = await send("POST", "/auth/refresh", { auth: false }, null);

          if (!response.ok) {
            accessToken = null;
            return null;
          }

          const session = await parse<AuthResponse>(response);
          accessToken = session.accessToken;
          return session;
        } catch {
          accessToken = null;
          return null;
        } finally {
          refreshing = null;
        }
      })();
    }

    return refreshing;
  }

  async function request<T>(
    method: string,
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    const auth = requestOptions.auth ?? true;
    let response = await send(method, path, requestOptions, auth ? accessToken : null);

    if (response.status === 401 && auth) {
      const renewed = await refreshSession();

      if (renewed) {
        response = await send(method, path, requestOptions, renewed.accessToken);
      } else {
        sessionLostHandler?.();
      }
    }

    return parse<T>(response);
  }

  return {
    get: <T>(path: string, requestOptions?: RequestOptions) =>
      request<T>("GET", path, requestOptions),
    post: <T>(path: string, body?: unknown, requestOptions?: RequestOptions) =>
      request<T>("POST", path, { ...requestOptions, body }),
    patch: <T>(path: string, body?: unknown, requestOptions?: RequestOptions) =>
      request<T>("PATCH", path, { ...requestOptions, body }),
    delete: <T>(path: string, requestOptions?: RequestOptions) =>
      request<T>("DELETE", path, requestOptions),
    refreshSession,
    setAccessToken(token: string | null) {
      accessToken = token;
    },
    hasAccessToken: () => accessToken !== null,
    onSessionLost(handler: (() => void) | null) {
      sessionLostHandler = handler;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
