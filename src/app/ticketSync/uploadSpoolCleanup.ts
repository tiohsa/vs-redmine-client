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
  const cleanupPass = async (): Promise<void> => {
    try {
      await input.store.cleanupUnreferenced(() => getPersistedUploadSpoolReferences(input.storage));
    } catch (error) {
      try { warn(error); }
      catch (warningError) { console.warn("[vs-redmine-client] Upload spool warning failed", warningError); }
    }
  };
  let running: Promise<void> | undefined;
  let dirty = false;
  let disposed = false;
  const cleanup = (): Promise<void> => {
    if (disposed) { return Promise.resolve(); }
    if (running) {
      dirty = true;
      return running;
    }
    running = Promise.resolve().then(async () => {
      try {
        do {
          dirty = false;
          await cleanupPass();
        } while (dirty && !disposed);
      } finally {
        // 最後の dirty 判定と running 解除の間に別の microtask を挟まない。
        running = undefined;
      }
    });
    return running;
  };
  const unsubscribe = onOfflineSyncQueueChanged(() => { void cleanup(); });
  return { dispose: () => { disposed = true; dirty = false; unsubscribe(); }, cleanup };
};
