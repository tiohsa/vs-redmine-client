import * as vscode from "vscode";

const SECRET_KEY = "redmine-client.apiKey";

let _cachedKey: string | undefined;
let _secrets: vscode.SecretStorage | undefined;

export const getCachedApiKey = (): string | undefined => _cachedKey;

export const initializeApiKeyStore = async (
  secrets: vscode.SecretStorage,
  subscriptions: vscode.Disposable[],
): Promise<void> => {
  _secrets = secrets;
  const stored = await secrets.get(SECRET_KEY);
  _cachedKey = stored ?? undefined;
  subscriptions.push(
    secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY) {
        void secrets.get(SECRET_KEY).then((key) => {
          _cachedKey = key ?? undefined;
        });
      }
    }),
  );
};

export const setApiKey = async (key: string): Promise<void> => {
  if (!_secrets) {
    throw new Error("API key store not initialized.");
  }
  await _secrets.store(SECRET_KEY, key);
  _cachedKey = key;
};

export const clearApiKey = async (): Promise<void> => {
  if (!_secrets) {
    throw new Error("API key store not initialized.");
  }
  await _secrets.delete(SECRET_KEY);
  _cachedKey = undefined;
};

export type ApiKeyStatus = "secret" | "none";

export const getApiKeyStatus = async (): Promise<ApiKeyStatus> => {
  if (_secrets) {
    const key = await _secrets.get(SECRET_KEY);
    if (key) {
      return "secret";
    }
  }
  return "none";
};

export const isApiKeyConfigured = (): boolean => Boolean(_cachedKey);

export const resolveApiKey = (): string => {
  return _cachedKey ?? "";
};
