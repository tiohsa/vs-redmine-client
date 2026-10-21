/** HTTP応答を本文の内容に依存せず識別する。 */
export class RedmineHttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "RedmineHttpError";
  }
}

export const extractHttpStatusCode = (error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    if ("statusCode" in error && typeof error.statusCode === "number") {
      return error.statusCode;
    }
    if ("status" in error && typeof error.status === "number") {
      return error.status;
    }
  }
  // 旧形式の永続化済みエラーと外部依存の互換性を維持する。
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\((\d{3})\)/)
    ?? message.match(/^(?:HTTP\s*|status(?:\s*code)?[\s:]*|code[\s:]*|\()(\d{3})\b/i)
    ?? message.match(/^(\d{3})(?:\s|$)/);
  return match ? Number(match[1]) : undefined;
};
