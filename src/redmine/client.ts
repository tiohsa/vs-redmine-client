import * as https from "https";
import * as http from "http";
import { getApiKey, getBaseUrl, getIgnoreSSLErrors } from "../config/settings";

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

const buildHeaders = (apiKey: string, headers?: Record<string, string>): Record<string, string> => {
  return {
    "X-Redmine-API-Key": apiKey,
    ...headers,
  };
};

const performRequest = (
  urlStr: string,
  options: RequestOptions,
  headers: Record<string, string>,
): Promise<{ statusCode: number; statusText: string; body: string }> => {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === "https:";
    const requestModule = isHttps ? https : http;
    const ignoreSSL = getIgnoreSSLErrors();

    const contentType = options.contentType ?? "application/json";
    let bodyContent: string | Uint8Array | undefined;

    if (options.body !== undefined) {
      headers["Content-Type"] = contentType;
      bodyContent =
        contentType === "application/json"
          ? JSON.stringify(options.body)
          : (options.body as FetchBody);
      headers["Content-Length"] = String(Buffer.byteLength(bodyContent));
    }

    const reqOptions: https.RequestOptions = {
      method: options.method,
      headers: headers,
      rejectUnauthorized: isHttps ? !ignoreSSL : undefined,
    };

    const req = requestModule.request(url, reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode || 0,
          statusText: res.statusMessage || "",
          body: buffer.toString("utf-8"),
        });
      });
    });

    req.on("error", (err) => {
      reject(new Error(`Network request failed: ${err.message}`));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (bodyContent !== undefined) {
      req.write(bodyContent);
    }

    req.end();
  });
};

export const requestJson = async <T>(options: RequestOptions): Promise<T> => {
  const { baseUrl, apiKey } = ensureConfig();
  const url = buildUrl(baseUrl, options.path, options.query);
  const headers = buildHeaders(apiKey, options.headers);

  const response = await performRequest(url, options, headers);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Redmine request failed (${response.statusCode}): ${response.body || response.statusText}`,
    );
  }

  if (!response.body) {
    return {} as T;
  }

  try {
    return JSON.parse(response.body) as T;
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

  // Override content type for text request if body is present
  const textOptions = { ...options, contentType };

  const response = await performRequest(url, textOptions, headers);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Redmine request failed (${response.statusCode}): ${response.body || response.statusText}`,
    );
  }

  return response.body;
};
