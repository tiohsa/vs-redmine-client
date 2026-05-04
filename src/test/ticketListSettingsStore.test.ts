import * as assert from "assert";
import type { Memento } from "vscode";
import {
  initializeTicketListSettingsStore,
  getStoredTicketListSettings,
  setStoredTicketListSettings,
  clearStoredTicketListSettings,
} from "../views/ticketListSettingsStore";
import { DEFAULT_TICKET_LIST_SETTINGS } from "../views/projectListSettings";

const makeMemento = (): Memento => {
  const data = new Map<string, unknown>();
  return {
    keys: () => Array.from(data.keys()),
    get: <T>(key: string, defaultValue?: T): T =>
      (data.has(key) ? data.get(key) : defaultValue) as T,
    update: (key: string, value: unknown) => {
      if (value === undefined) {
        data.delete(key);
      } else {
        data.set(key, value);
      }
      return Promise.resolve();
    },
  };
};

suite("ticketListSettingsStore", () => {
  setup(() => {
    initializeTicketListSettingsStore(makeMemento());
  });

  test("初期状態はデフォルト設定と一致する", () => {
    const s = getStoredTicketListSettings();
    assert.deepStrictEqual(s, DEFAULT_TICKET_LIST_SETTINGS);
  });

  test("setStoredTicketListSettings: 設定を保存できる", () => {
    const settings = {
      ...DEFAULT_TICKET_LIST_SETTINGS,
      filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "test" },
    };
    setStoredTicketListSettings(settings);
    assert.strictEqual(getStoredTicketListSettings().filters.subjectQuery, "test");
  });

  test("clearStoredTicketListSettings: デフォルトに戻る", () => {
    setStoredTicketListSettings({
      ...DEFAULT_TICKET_LIST_SETTINGS,
      filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "test" },
    });
    clearStoredTicketListSettings();
    assert.strictEqual(getStoredTicketListSettings().filters.subjectQuery, "");
  });

  test("initializeTicketListSettingsStore: 保存済み設定を復元する", () => {
    const memento = makeMemento();
    initializeTicketListSettingsStore(memento);
    setStoredTicketListSettings({
      ...DEFAULT_TICKET_LIST_SETTINGS,
      filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, priorityIds: [1, 2] },
    });

    initializeTicketListSettingsStore(memento);
    const restored = getStoredTicketListSettings();
    assert.deepStrictEqual(restored.filters.priorityIds, [1, 2]);
  });

  test("initializeTicketListSettingsStore: 保存なしの場合はデフォルトを使う", () => {
    const memento = makeMemento();
    initializeTicketListSettingsStore(memento);
    const s = getStoredTicketListSettings();
    assert.deepStrictEqual(s, DEFAULT_TICKET_LIST_SETTINGS);
  });

  test("不正な保存データはデフォルト値にフォールバックする", () => {
    const memento = makeMemento();
    // 不正なデータを直接書き込む
    void memento.update("redmine-client.ticketListSettings", {
      filters: { subjectQuery: 123, priorityIds: "bad", includeUnassigned: "yes" },
      sort: { field: "unknown", direction: "invalid" },
      dueDate: { showWithin7Days: "true" },
    });
    initializeTicketListSettingsStore(memento);
    const s = getStoredTicketListSettings();
    assert.strictEqual(s.filters.subjectQuery, "");
    assert.deepStrictEqual(s.filters.priorityIds, []);
    assert.strictEqual(s.filters.includeUnassigned, true);
    assert.strictEqual(s.sort.field, undefined);
    assert.strictEqual(s.sort.direction, "asc");
    assert.strictEqual(s.dueDate.showWithin7Days, true);
  });

  test("getStoredTicketListSettings: 返り値はディープコピーである", () => {
    const s1 = getStoredTicketListSettings();
    s1.filters.subjectQuery = "mutated";
    const s2 = getStoredTicketListSettings();
    assert.strictEqual(s2.filters.subjectQuery, "");
  });
});
