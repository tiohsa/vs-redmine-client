import { AsyncLocalStorage } from "async_hooks";
import type { Memento } from "vscode";
import { deserializeQueue, emptyQueue, serializeQueueFrom, type SerializedQueue } from "./offlineSyncQueueCodec";
import type { OfflineSyncQueue } from "./offlineSyncTypes";

const STORAGE_KEY = "redmine.offlineSyncQueue";
const storageKeyForScope = (scope?: string): string =>
  scope ? `${STORAGE_KEY}.${encodeURIComponent(scope)}` : STORAGE_KEY;

type QueueChangeListener = () => void;

const queueChangeListeners = new Set<QueueChangeListener>();

const notifyQueueChanged = (): void => {
  for (const listener of Array.from(queueChangeListeners)) {
    listener();
  }
};

export const onOfflineSyncQueueChanged = (
  listener: QueueChangeListener,
): (() => void) => {
  queueChangeListeners.add(listener);
  return () => {
    queueChangeListeners.delete(listener);
  };
};

let memento: Memento | undefined;
let activeScope = "";
export const getActiveScope = (): string => activeScope;
const queuesByScope = new Map<string, OfflineSyncQueue>();
const persistenceByScope = new Map<string, Promise<void>>();

const mutationContext = new AsyncLocalStorage<Set<string>>();
const mutationByScope = new Map<string, Promise<unknown>>();

const runScopeMutation = <T>(scope: string, mutation: () => Promise<T>): Promise<T> => {
  const activeScopes = mutationContext.getStore();
  if (activeScopes?.has(scope)) {
    return mutation();
  }

  const previous = mutationByScope.get(scope);
  if (!previous) {
    const nextScopes = new Set(activeScopes ?? []);
    nextScopes.add(scope);
    const current = mutationContext.run(nextScopes, mutation);
    const pending = current.catch(() => undefined);
    mutationByScope.set(scope, pending);
    void pending.then(() => {
      if (mutationByScope.get(scope) === pending) {
        mutationByScope.delete(scope);
      }
    });
    return current;
  }

  const current = previous.then(() => {
    const nextScopes = new Set(activeScopes ?? []);
    nextScopes.add(scope);
    return mutationContext.run(nextScopes, mutation);
  });
  const pending = current.catch(() => undefined);
  mutationByScope.set(scope, pending);
  void pending.then(
    () => {
      if (mutationByScope.get(scope) === pending) {
        mutationByScope.delete(scope);
      }
    },
    () => {
      if (mutationByScope.get(scope) === pending) {
        mutationByScope.delete(scope);
      }
    },
  );
  return current;
};

export const cloneQueueForMutation = (queue: OfflineSyncQueue): OfflineSyncQueue =>
  structuredClone(queue);

type QueueMutationResult<T> =
  | { commit: true; result: T }
  | { commit: false; result: T };

export const commitQueueMutation = <T>(result: T): QueueMutationResult<T> => ({
  commit: true,
  result,
});

export const skipQueueMutation = <T>(result: T): QueueMutationResult<T> => ({
  commit: false,
  result,
});

export const getQueue = (scope = activeScope): OfflineSyncQueue => {
  let queue = queuesByScope.get(scope);
  if (!queue) {
    queue = memento ? loadQueue(memento, storageKeyForScope(scope)) : emptyQueue();
    queuesByScope.set(scope, queue);
  }
  return queue;
};

const serializeQueue = (scope: string): SerializedQueue =>
  serializeQueueFrom(getQueue(scope), scope);

const schedulePersist = (
  scope: string,
  serialized: SerializedQueue,
  clearLegacy = false,
): Promise<void> => {
  const targetMemento = memento;
  const previous = persistenceByScope.get(scope);
  const perform = async (): Promise<void> => {
    if (targetMemento) {
      await targetMemento.update(storageKeyForScope(scope), serialized);
      if (clearLegacy) {
        await targetMemento.update(STORAGE_KEY, undefined);
      }
    }
  };
  const current = previous
    ? previous.catch(() => undefined).then(perform)
    : perform();
  persistenceByScope.set(scope, current);
  void current.finally(() => {
    if (persistenceByScope.get(scope) === current) {
      persistenceByScope.delete(scope);
    }
  }).catch(() => undefined);
  return current;
};

export const mutateQueueAsync = <T>(
  scope: string,
  mutation: (
    candidate: OfflineSyncQueue,
  ) => QueueMutationResult<T> | Promise<QueueMutationResult<T>>,
): Promise<T> => runScopeMutation(scope, async () => {
  const candidate = cloneQueueForMutation(getQueue(scope));
  const outcome = await mutation(candidate);
  if (!outcome.commit) {
    return outcome.result;
  }

  await schedulePersist(scope, serializeQueueFrom(candidate, scope));
  queuesByScope.set(scope, candidate);
  notifyQueueChanged();
  return outcome.result;
});

export const mutateOfflineSyncQueueAsync = <T>(
  scope: string,
  mutation: (candidate: OfflineSyncQueue) => T | undefined | Promise<T | undefined>,
): Promise<T | undefined> => mutateQueueAsync(scope, async (candidate) => {
  const result = await mutation(candidate);
  return result === undefined
    ? skipQueueMutation(undefined)
    : commitQueueMutation(result);
});

export const persistAsync = (scope = activeScope): Promise<void> =>
  runScopeMutation(scope, async () => {
    await schedulePersist(scope, serializeQueue(scope));
    notifyQueueChanged();
  });

function loadQueue(storage: Memento, storageKey: string): OfflineSyncQueue {
  return deserializeQueue(storage.get<SerializedQueue>(storageKey), activeScope);
}

export const initializeOfflineSyncStore = (storage: Memento, scope?: string): void => {
  const sameStorage = memento === storage;
  const requestedScope = scope ?? "";
  memento = storage;
  activeScope = requestedScope;
  queuesByScope.clear();
  if (!sameStorage) {
    persistenceByScope.clear();
  }
  const activeStorageKey = storageKeyForScope(activeScope);
  const scoped = storage.get<SerializedQueue>(activeStorageKey);
  const legacy = scope ? storage.get<SerializedQueue>(STORAGE_KEY) : undefined;
  const queue = deserializeQueue(scoped ?? legacy, activeScope);
  queuesByScope.set(activeScope, queue);
  if ((!scoped?.operations && (scoped || legacy))) {
    const migrationScope = activeScope;
    const current = runScopeMutation(migrationScope, () => schedulePersist(
      migrationScope,
      serializeQueue(migrationScope),
      Boolean(scope && !scoped && legacy),
    ));
    void current.catch((err: unknown) => {
      console.error("[vs-redmine-client] offlineSyncStore: migration failed", err);
    });
  }
};

export const switchOfflineSyncStore = (scope: string): void => {
  if (!memento) {
    return;
  }
  activeScope = scope;
  getQueue(scope);
  notifyQueueChanged();
};

export const getPersistedUploadSpoolReferences = (storage: Memento): ReadonlySet<string> => {
  const references = new Set<string>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") { return; }
    if ("kind" in value && value.kind === "upload" &&
        "spoolFilePath" in value && typeof value.spoolFilePath === "string") {
      references.add(value.spoolFilePath);
    }
    for (const entry of Object.values(value)) { visit(entry); }
  };
  for (const key of storage.keys()) {
    if (key === STORAGE_KEY || key.startsWith(`${STORAGE_KEY}.`)) {
      visit(storage.get<unknown>(key));
    }
  }
  return references;
};

export const getOfflineSyncQueue = (scope = getActiveScope()): OfflineSyncQueue => {
  return structuredClone(getQueue(scope));
};

export const clearOfflineSyncQueueAsync = (scope = getActiveScope()): Promise<void> =>
  mutateQueueAsync(scope, (queue) => {
  queue.tickets.clear();
  queue.abandonedTickets = [];
  queue.ticketEditAuthorizations = [];
  queue.comments = [];
  queue.newTickets = [];
  return commitQueueMutation(undefined);
  });

export const replaceOfflineSyncQueueAsync = async (
  next: OfflineSyncQueue,
  scope = getActiveScope(),
): Promise<void> => mutateQueueAsync(scope, (candidate) => {
  const isolated = cloneQueueForMutation(next);
  candidate.tickets = isolated.tickets;
  candidate.abandonedTickets = isolated.abandonedTickets;
  candidate.ticketEditAuthorizations = isolated.ticketEditAuthorizations;
  candidate.comments = isolated.comments;
  candidate.newTickets = isolated.newTickets;
  return commitQueueMutation(undefined);
});
