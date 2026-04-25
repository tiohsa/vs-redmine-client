export type RedmineErrorType =
  | "auth_failure"
  | "permission_denied"
  | "validation_error"
  | "network_failure"
  | "server_error"
  | "conflict"
  | "unexpected";

const ERROR_MESSAGES: Record<RedmineErrorType, string> = {
  auth_failure: "認証に失敗しました。APIキーを確認してください。",
  permission_denied: "このチケットへのアクセス権がありません。",
  validation_error: "入力値が正しくありません。内容を確認してください。",
  network_failure: "Redmine に接続できませんでした。ネットワークを確認してください。",
  server_error: "Redmine サーバーでエラーが発生しました。",
  conflict: "リモートで変更が検出されました。最新情報を取得してから保存してください。",
  unexpected: "予期しないエラーが発生しました。",
};

export const classifyError = (error: unknown, statusCode?: number): RedmineErrorType => {
  const code = statusCode ?? extractStatusCode(error);
  if (code === 401) { return "auth_failure"; }
  if (code === 403) { return "permission_denied"; }
  if (code === 409) { return "conflict"; }
  if (code === 422) { return "validation_error"; }
  if (code !== undefined && code >= 500) { return "server_error"; }

  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(message)) {
    return "network_failure";
  }
  return "unexpected";
};

export const getUserMessage = (type: RedmineErrorType): string =>
  ERROR_MESSAGES[type];

export const getTechnicalMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const extractStatusCode = (error: unknown): number | undefined => {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\((\d{3})\)/);
  return match ? Number(match[1]) : undefined;
};
