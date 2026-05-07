import * as assert from "assert";
import { SettingsController } from "../dashboard/SettingsController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DEFAULT_TICKET_LIST_SETTINGS } from "../views/projectListSettings";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";
import { initializeTicketListSettingsStore } from "../views/ticketListSettingsStore";

const makeStore = (): DashboardStateStore => new DashboardStateStore();

const makeMemento = (): import("vscode").Memento => {
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

suite("SettingsController", () => {
  setup(() => {
    resetTicketEditorDefaults();
    initializeTicketListSettingsStore(makeMemento());
  });

  test("初期状態は DEFAULT_TICKET_LIST_SETTINGS と一致する", () => {
    const ctrl = new SettingsController(makeStore());
    const s = ctrl.getSettings();
    assert.deepStrictEqual(s.filters, DEFAULT_TICKET_LIST_SETTINGS.filters);
    assert.deepStrictEqual(s.sort, DEFAULT_TICKET_LIST_SETTINGS.sort);
    assert.deepStrictEqual(s.dueDate, DEFAULT_TICKET_LIST_SETTINGS.dueDate);
  });

  test("コンストラクタで store に初期設定が即時反映される", () => {
    const memento = makeMemento();
    initializeTicketListSettingsStore(memento);
    // 一度設定を保存してからリロード
    const ctrl1 = new SettingsController(makeStore());
    ctrl1.updateTicketList({ filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "init-push" } });
    initializeTicketListSettingsStore(memento);

    const store = makeStore();
    new SettingsController(store);
    // コンストラクタ呼び出し直後にストアへ反映されているか確認
    assert.strictEqual(store.getState().settings.filters.subjectQuery, "init-push");
  });

  test("updateTicketList: filters を部分更新できる", () => {
    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({ filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "bug" } });
    assert.strictEqual(ctrl.getSettings().filters.subjectQuery, "bug");
  });

  test("updateTicketList: sort を部分更新できる", () => {
    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({ sort: { field: "priority", direction: "desc" } });
    assert.strictEqual(ctrl.getSettings().sort.field, "priority");
    assert.strictEqual(ctrl.getSettings().sort.direction, "desc");
  });

  test("updateTicketList: dueDate を部分更新できる", () => {
    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({ dueDate: { ...DEFAULT_TICKET_LIST_SETTINGS.dueDate, showOverdue: false } });
    assert.strictEqual(ctrl.getSettings().dueDate.showOverdue, false);
    assert.strictEqual(ctrl.getSettings().dueDate.showWithin7Days, true);
  });

  test("resetTicketList: DEFAULT に戻る", () => {
    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({ filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "test" } });
    ctrl.resetTicketList();
    assert.strictEqual(ctrl.getSettings().filters.subjectQuery, "");
  });

  test("updateEditorDefault: 有効フィールドを更新できる", () => {
    const ctrl = new SettingsController(makeStore());
    ctrl.updateEditorDefault("subject", "Default Subject");
    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "Default Subject");
  });

  test("updateEditorDefault: tracker フィールドを更新できる", () => {
    const ctrl = new SettingsController(makeStore());
    ctrl.updateEditorDefault("tracker", "Bug");
    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.metadata.tracker, "Bug");
  });

  test("updateEditorDefault: 未知フィールドは無視される", () => {
    const ctrl = new SettingsController(makeStore());
    const before = getTicketEditorDefaults();
    ctrl.updateEditorDefault("unknown_field", "value");
    const after = getTicketEditorDefaults();
    assert.deepStrictEqual(before, after);
  });

  test("resetEditorDefaults: 指定フィールドをリセットする", () => {
    updateTicketEditorDefaultField("subject", "Test Subject");
    updateTicketEditorDefaultField("tracker", "Bug");
    const ctrl = new SettingsController(makeStore());
    ctrl.resetEditorDefaults(["subject"]);
    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "");
    assert.strictEqual(defaults.metadata.tracker, "Bug");
  });

  test("resetEditorDefaults: 空配列は何もしない", () => {
    updateTicketEditorDefaultField("subject", "Test");
    const ctrl = new SettingsController(makeStore());
    ctrl.resetEditorDefaults([]);
    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "Test");
  });

  test("resetEditorDefaults: 未知フィールドは無視される", () => {
    updateTicketEditorDefaultField("subject", "Test");
    const ctrl = new SettingsController(makeStore());
    ctrl.resetEditorDefaults(["unknown", "subject"]);
    const defaults = getTicketEditorDefaults();
    assert.strictEqual(defaults.subject, "");
  });

  test("pushSettings: store に settings が反映される", () => {
    const store = makeStore();
    const ctrl = new SettingsController(store);
    ctrl.updateTicketList({ filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "hello" } });
    const storeSettings = store.getState().settings;
    assert.strictEqual(storeSettings.filters.subjectQuery, "hello");
  });

  test("pushSettings: showStatus と showDueDate が store の settings に含まれる", () => {
    const store = makeStore();
    const ctrl = new SettingsController(store);
    ctrl.pushSettings();
    const s = store.getState().settings;
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showStatus"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showDueDate"));
  });

  test("updateTicketList: 設定が永続化され次回起動時に復元される", () => {
    const memento = makeMemento();
    initializeTicketListSettingsStore(memento);
    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({ filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "persist" } });

    // 新しいストアとコントローラーでリロードをシミュレート
    initializeTicketListSettingsStore(memento);
    const ctrl2 = new SettingsController(makeStore());
    assert.strictEqual(ctrl2.getSettings().filters.subjectQuery, "persist");
  });

  test("resetTicketList: リセット後は次回起動時もデフォルトになる", () => {
    const memento = makeMemento();
    initializeTicketListSettingsStore(memento);
    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({ filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "persist" } });
    ctrl.resetTicketList();

    initializeTicketListSettingsStore(memento);
    const ctrl2 = new SettingsController(makeStore());
    assert.strictEqual(ctrl2.getSettings().filters.subjectQuery, "");
  });
});
