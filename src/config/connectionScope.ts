import { normalizeBaseUrl } from "../redmine/client";
import { createHash } from "crypto";
import { getBaseUrl } from "./settings";

export const CONNECTION_SCOPE_MISMATCH_MESSAGE =
  "This editor belongs to another Redmine connection. Switch back to the original connection before syncing.";

/** 表記揺れで同じ接続先の状態を別スコープに分割しないための識別子。 */
export const getConnectionScope = (rawBaseUrl: string): string => {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return normalizeBaseUrl(trimmed);
  } catch {
    // 設定途中の不正URLでも決定的なスコープを返し、別接続先と混在させない。
    return trimmed;
  }
};

export const getCurrentConnectionScope = (): string =>
  getConnectionScope(getBaseUrl());

export const getConnectionScopeHash = (scope: string): string =>
  createHash("sha256").update(scope, "utf8").digest("hex").slice(0, 16);
