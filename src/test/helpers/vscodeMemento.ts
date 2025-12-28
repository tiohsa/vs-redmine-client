type MementoValue = unknown;

export type TestMemento = {
  get: <T>(key: string, defaultValue?: T) => T;
  update: (key: string, value: MementoValue) => Thenable<void>;
  keys: () => readonly string[];
};

export const createTestMemento = (): TestMemento => {
  const store = new Map<string, MementoValue>();
  return {
    get: <T>(key: string, defaultValue?: T): T => {
      if (store.has(key)) {
        return store.get(key) as T;
      }
      return defaultValue as T;
    },
    update: async (key: string, value: MementoValue): Promise<void> => {
      store.set(key, value);
    },
    keys: (): readonly string[] => Array.from(store.keys()),
  };
};
