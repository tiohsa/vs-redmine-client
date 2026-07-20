import { normalizeBaseUrl } from "../redmine/client";

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
