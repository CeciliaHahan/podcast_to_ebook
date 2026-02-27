import type { ApiErrorEnvelope } from "./types";

export class ApiClientError extends Error {
  code: string;
  requestId: string;
  status: number;

  constructor(status: number, code: string, message: string, requestId: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string> | string;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string> | string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getToken = options.getToken;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: formData,
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      let payload: ApiErrorEnvelope | null = null;
      try {
        payload = (await response.json()) as ApiErrorEnvelope;
      } catch {
        payload = null;
      }
      throw new ApiClientError(
        response.status,
        payload?.error.code ?? "UNKNOWN_ERROR",
        payload?.error.message ?? "Request failed.",
        payload?.error.request_id ?? "unknown",
      );
    }
    return (await response.json()) as T;
  }
}
