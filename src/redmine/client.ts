import { getApiKey, getBaseUrl } from "../config/settings";

type HttpMethod = "GET" | "POST" | "PUT";
type FetchBody = string | Uint8Array;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string;
}

const ensureConfig = (): { baseUrl: string; apiKey: string } => {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  if (!baseUrl) {
    throw new Error("Missing Redmine base URL configuration.");
  }
  if (!apiKey) {
    throw new Error("Missing Redmine API key configuration.");
  }
  return { baseUrl, apiKey };
};

const buildUrl = (baseUrl: string, path: string, query?: QueryParams): string => {
  const url = new URL(path, baseUrl);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
};

const buildHeaders = (apiKey: string, headers?: Record<string, string>): Headers => {
  const merged = {
    "X-Redmine-API-Key": apiKey,
    ...headers,
  };
  return new Headers(merged);
};

export const requestJson = async <T>(options: RequestOptions): Promise<T> => {
  const { baseUrl, apiKey } = ensureConfig();
  const url = buildUrl(baseUrl, options.path, options.query);
  const headers = buildHeaders(apiKey, options.headers);
  const contentType = options.contentType ?? "application/json";

  let body: FetchBody | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", contentType);
    body =
      contentType === "application/json"
        ? JSON.stringify(options.body)
        : (options.body as FetchBody);
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Redmine request failed (${response.status}): ${errorText || response.statusText}`,
    );
  }

  return (await response.json()) as T;
};

export const requestText = async (options: RequestOptions): Promise<string> => {
  const { baseUrl, apiKey } = ensureConfig();
  const url = buildUrl(baseUrl, options.path, options.query);
  const headers = buildHeaders(apiKey, options.headers);
  const contentType = options.contentType ?? "text/plain";

  let body: FetchBody | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", contentType);
    body = options.body as FetchBody;
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Redmine request failed (${response.status}): ${errorText || response.statusText}`,
    );
  }

  return response.text();
};
