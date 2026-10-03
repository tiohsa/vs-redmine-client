export const SAVE_DEBOUNCE_MS = 150;

const saveDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const saveQueues = new Map<string, Promise<void>>();

export type SaveErrorObserver = (error: unknown, uri: string) => void | Promise<void>;

const logSaveError: SaveErrorObserver = (error, uri) => {
  console.error("Save execution failed", uri, error);
};

export const enqueueSave = (
  uri: string,
  task: () => Promise<void>,
  onError: SaveErrorObserver = logSaveError,
): void => {
  const previous = saveQueues.get(uri) ?? Promise.resolve();
  const next = previous
    .then(task)
    .catch((error: unknown) => {
      try {
        // Notifications may stay open indefinitely. Observe their failures without delaying saves.
        void Promise.resolve(onError(error, uri)).catch(() => undefined);
      } catch {
        // The queue owns observer failures as well; its tail must always settle successfully.
      }
    })
    .finally(() => {
      if (saveQueues.get(uri) === next) {
        saveQueues.delete(uri);
      }
    });
  saveQueues.set(uri, next);
};

export const scheduleSave = (
  uri: string,
  task: () => Promise<void>,
  onError: SaveErrorObserver = logSaveError,
): void => {
  const existingTimer = saveDebounce.get(uri);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    saveDebounce.delete(uri);
    enqueueSave(uri, task, onError);
  }, SAVE_DEBOUNCE_MS);

  saveDebounce.set(uri, timer);
};
