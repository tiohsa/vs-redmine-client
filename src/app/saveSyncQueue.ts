export const SAVE_DEBOUNCE_MS = 150;

const saveDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const saveQueues = new Map<string, Promise<void>>();

export const enqueueSave = (uri: string, task: () => Promise<void>): void => {
  const previous = saveQueues.get(uri) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (saveQueues.get(uri) === next) {
        saveQueues.delete(uri);
      }
    });
  saveQueues.set(uri, next);
};

export const scheduleSave = (uri: string, task: () => Promise<void>): void => {
  const existingTimer = saveDebounce.get(uri);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    saveDebounce.delete(uri);
    enqueueSave(uri, task);
  }, SAVE_DEBOUNCE_MS);

  saveDebounce.set(uri, timer);
};
