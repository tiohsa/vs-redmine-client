import type { Memento } from "vscode";
import { getPersistedUploadSpoolReferences, onOfflineSyncQueueChanged } from "../../views/offlineSyncStore";
import type { UploadSpoolStore } from "./ports";

/** Cleanup failure は同期 journal へ戻さず、この observer が終端で所有する。 */
export const observeUploadSpoolCleanup = (input: {
  store: UploadSpoolStore;
  storage: Memento;
  warn?: (error: unknown) => void;
}): { dispose(): void; cleanup(): Promise<void> } => {
  const warn = input.warn ?? ((error: unknown) => {
    console.warn("[vs-redmine-client] Upload spool cleanup failed", error);
  });
  const cleanup = async (): Promise<void> => {
    try {
      await input.store.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(input.storage));
    } catch (error) {
      try { warn(error); }
      catch (warningError) { console.warn("[vs-redmine-client] Upload spool warning failed", warningError); }
    }
  };
  const dispose = onOfflineSyncQueueChanged(() => { void cleanup(); });
  return { dispose, cleanup };
};
