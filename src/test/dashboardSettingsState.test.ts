import * as assert from "assert";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { SettingsController } from "../dashboard/SettingsController";
import { buildSettingsDashboardViewModel } from "../dashboard/viewModels/settingsDashboardViewModel";
import { DEFAULT_TICKET_LIST_SETTINGS } from "../views/projectListSettings";

suite("dashboardSettingsState — 初期設定状態", () => {
  let store: DashboardStateStore;
  let ctrl: SettingsController;

  setup(() => {
    store = new DashboardStateStore();
    ctrl = new SettingsController(store);
  });

  test("pushSettings() を呼ぶと settings state が store に反映される", () => {
    ctrl.pushSettings();
    const settings = store.getState().settings;
    assert.ok(settings !== undefined, "settings が undefined でないこと");
    assert.ok(["auto", "manual"].includes(settings.offlineSyncMode));
  });

  test("pushSettings() 前の settings は DEFAULT_STATE のデフォルト値を持つ", () => {
    const settings = store.getState().settings;
    assert.strictEqual(settings.offlineSyncMode, "auto");
  });

  test("buildSettingsDashboardViewModel はデフォルト設定から正しい ViewModel を生成する", () => {
    const vm = buildSettingsDashboardViewModel(DEFAULT_TICKET_LIST_SETTINGS);
    assert.ok(["auto", "manual"].includes(vm.offlineSyncMode));
    assert.strictEqual(typeof vm.filters.subjectQuery, "string");
    assert.ok(Array.isArray(vm.filters.priorityIds));
    assert.ok(Array.isArray(vm.filters.statusIds));
    assert.strictEqual(typeof vm.dueDate.showOverdue, "boolean");
    assert.strictEqual(typeof vm.sort.direction, "string");
  });

  test("updateTicketList() 後 pushSettings() で settings が更新される", () => {
    ctrl.updateTicketList({ filters: { subjectQuery: "テスト", priorityIds: [], statusIds: [], trackerIds: [], assigneeIds: [], includeUnassigned: true } });
    const settings = store.getState().settings;
    assert.strictEqual(settings.filters.subjectQuery, "テスト");
  });

  test("resetTicketList() でデフォルト値に戻る", () => {
    ctrl.updateTicketList({ filters: { subjectQuery: "変更済み", priorityIds: [], statusIds: [], trackerIds: [], assigneeIds: [], includeUnassigned: true } });
    ctrl.resetTicketList();
    const settings = store.getState().settings;
    assert.strictEqual(settings.filters.subjectQuery, DEFAULT_TICKET_LIST_SETTINGS.filters.subjectQuery);
  });

  test("DashboardStateStore.DEFAULT_STATE の settings には offlineSyncMode が含まれる", () => {
    const fresh = new DashboardStateStore();
    const s = fresh.getState().settings;
    assert.ok(Object.prototype.hasOwnProperty.call(s, "offlineSyncMode"));
  });

  test("settings の dueDate フィールドが初期値を持つ", () => {
    ctrl.pushSettings();
    const { dueDate } = store.getState().settings;
    assert.strictEqual(typeof dueDate.showWithin7Days, "boolean");
    assert.strictEqual(typeof dueDate.showWithin3Days, "boolean");
    assert.strictEqual(typeof dueDate.showWithin1Day, "boolean");
    assert.strictEqual(typeof dueDate.showOverdue, "boolean");
  });

  test("DEFAULT_STATE の settings に表示設定が含まれる", () => {
    const fresh = new DashboardStateStore();
    const s = fresh.getState().settings;
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showStatus"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showDueDate"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showTracker"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showPriority"));
    assert.strictEqual(s.showStatus, true);
    assert.strictEqual(s.showDueDate, true);
    assert.strictEqual(s.showTracker, true);
    assert.strictEqual(s.showPriority, true);
  });

  test("buildSettingsDashboardViewModel に表示設定が含まれる", () => {
    const vm = buildSettingsDashboardViewModel(DEFAULT_TICKET_LIST_SETTINGS);
    assert.strictEqual(typeof vm.showStatus, "boolean");
    assert.strictEqual(typeof vm.showDueDate, "boolean");
    assert.strictEqual(typeof vm.showTracker, "boolean");
    assert.strictEqual(typeof vm.showPriority, "boolean");
  });

  test("buildSettingsDashboardViewModel に apiKeyStatus が含まれる", () => {
    const vm = buildSettingsDashboardViewModel(DEFAULT_TICKET_LIST_SETTINGS);
    assert.ok(vm.apiKeyStatus === "set" || vm.apiKeyStatus === "notSet");
    assert.strictEqual("apiKey" in vm, false, "API key 本体を ViewModel に含めないこと");
  });

  test("buildSettingsDashboardViewModel に Connection／Editor 設定が含まれる", () => {
    const vm = buildSettingsDashboardViewModel(DEFAULT_TICKET_LIST_SETTINGS);
    assert.strictEqual(typeof vm.baseUrl, "string");
    assert.strictEqual(typeof vm.defaultProjectId, "string");
    assert.strictEqual(typeof vm.requestTimeoutMs, "number");
    assert.strictEqual(typeof vm.ignoreSSLErrors, "boolean");
    assert.strictEqual(typeof vm.includeChildProjects, "boolean");
    assert.strictEqual(typeof vm.editorStorageDirectory, "string");
    assert.strictEqual(typeof vm.editorDefaults.subject, "string");
    assert.strictEqual(typeof vm.editorDefaults.description, "string");
    assert.strictEqual(typeof vm.editorDefaults.due_date, "string");
  });

  test("DEFAULT_STATE の settings に apiKeyStatus が含まれる", () => {
    const fresh = new DashboardStateStore();
    const s = fresh.getState().settings;
    assert.ok(Object.prototype.hasOwnProperty.call(s, "apiKeyStatus"));
    assert.strictEqual(s.apiKeyStatus, "notSet");
  });
});
