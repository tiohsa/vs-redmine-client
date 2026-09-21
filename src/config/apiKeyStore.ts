import * as vscode from "vscode";
import { getConnectionScope, getConnectionScopeHash, getCurrentConnectionScope } from "./connectionScope";
import { getBaseUrl } from "./settings";
import { normalizeBaseUrl } from "../redmine/client";

const SECRET_KEY = "redmine-client.apiKey";
const LEGACY_SCOPE_KEY = `${SECRET_KEY}.legacyScope`;

let _secrets: vscode.SecretStorage | undefined;
const cachedKeys = new Map<string, string>();
let initialization: Promise<void> = Promise.resolve();

const scopedSecretKey = (scope: string): string =>
  `${SECRET_KEY}:${getConnectionScopeHash(getConnectionScope(scope))}`;

export const getCachedApiKey = (): string | undefined =>
  cachedKeys.get(scopedSecretKey(getCurrentConnectionScope()));

// 移行先を先に永続化し、store/delete の失敗後も別接続先へコピーしない。
const migrateLegacyKey = async (secrets: vscode.SecretStorage, configuredBaseUrl: string): Promise<void> => {
  let scope: string;
  try {
    scope = getConnectionScope(normalizeBaseUrl(configuredBaseUrl));
  } catch {
    return;
  }
  const legacy = await secrets.get(SECRET_KEY);
  if (legacy === undefined) { return; }
  const owner = await secrets.get(LEGACY_SCOPE_KEY);
  if (owner !== undefined && owner !== scope) { return; }
  if (owner === undefined) { await secrets.store(LEGACY_SCOPE_KEY, scope); }
  const target = scopedSecretKey(scope);
  if (await secrets.get(target) === undefined) {
    await secrets.store(target, legacy);
  }
  await secrets.delete(SECRET_KEY);
};

export const initializeApiKeyStore = (
  secrets: vscode.SecretStorage,
  subscriptions: vscode.Disposable[],
): Promise<void> => {
  // AsyncLocalStorage の一時的な scope ではなく、初期化開始時の設定へ移行する。
  const configuredBaseUrl = getBaseUrl();
  const initialize = async (): Promise<void> => {
    _secrets = secrets;
    cachedKeys.clear();
    await migrateLegacyKey(secrets, configuredBaseUrl);
    const revisions = new Map<string, number>();
    const refresh = async (key: string): Promise<void> => {
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      const value = await secrets.get(key);
      if (_secrets !== secrets || revisions.get(key) !== revision) { return; }
      if (value === undefined) { cachedKeys.delete(key); }
      else { cachedKeys.set(key, value); }
    };
    subscriptions.push(secrets.onDidChange((event) => {
      if (_secrets === secrets && event.key.startsWith(`${SECRET_KEY}:`)) {
        cachedKeys.delete(event.key);
        void refresh(event.key).catch(() => { cachedKeys.delete(event.key); });
      }
    }));
    await Promise.all((await secrets.keys())
      .filter((key) => key.startsWith(`${SECRET_KEY}:`))
      .map(refresh));
  };
  const result = initialization.then(initialize);
  initialization = result.catch(() => undefined);
  return result;
};

export const resolveApiKeyForScope = async (scope: string): Promise<string> =>
  (await _secrets?.get(scopedSecretKey(scope))) ?? "";

export const setApiKeyForScope = async (scope: string, key: string): Promise<void> => {
  if (!_secrets) { throw new Error("API key store not initialized."); }
  // 未設定・不正な接続先へ認証情報を保存しない。
  const target = scopedSecretKey(normalizeBaseUrl(scope));
  await _secrets.store(target, key);
  cachedKeys.set(target, key);
};

export const clearApiKeyForScope = async (scope: string): Promise<void> => {
  if (!_secrets) { throw new Error("API key store not initialized."); }
  const target = scopedSecretKey(scope);
  await _secrets.delete(target);
  cachedKeys.delete(target);
};

export const setApiKey = (key: string): Promise<void> =>
  setApiKeyForScope(getCurrentConnectionScope(), key);

export const clearApiKey = (): Promise<void> =>
  clearApiKeyForScope(getCurrentConnectionScope());

export type ApiKeyStatus = "secret" | "none";

export const getApiKeyStatus = async (): Promise<ApiKeyStatus> =>
  (await resolveApiKeyForScope(getCurrentConnectionScope())) ? "secret" : "none";

export const isApiKeyConfigured = (): boolean => Boolean(getCachedApiKey());

// 同期 UI の互換 API。HTTP request は必ず scoped SecretStorage を参照する。
export const resolveApiKey = (): string => getCachedApiKey() ?? "";
