import { getApiKey, getBaseUrl } from "../config/settings";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
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

export const normalizeBaseUrl = (rawBaseUrl: string): string => {
  try {
    const url = new URL(rawBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Base URL must start with http:// or https://");
    }
    return url.toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid base URL.";
    throw new Error(
      `Invalid Redmine base URL. Use http:// or https:// and remove spaces. (${message})`,
    );
  }
};

const ensureConfig = (): { baseUrl: string; apiKey: string } => {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  if (!baseUrl) {
    throw new Error("Missing Redmine base URL configuration.");
  }
  if (!apiKey) {
    throw new Error("Missing Redmine API key configuration.");
  }
  return { baseUrl: normalizeBaseUrl(baseUrl), apiKey };
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

  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Redmine response was not valid JSON. (${(error as Error).message})`,
    );
  }
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
