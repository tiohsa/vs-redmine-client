import * as assert from "assert";
import { SettingsController } from "../dashboard/SettingsController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DEFAULT_TICKET_LIST_SETTINGS } from "../views/projectListSettings";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";

const makeStore = (): DashboardStateStore => new DashboardStateStore();

suite("SettingsController", () => {
  setup(() => {
    resetTicketEditorDefaults();
  });

  test("初期状態は DEFAULT_TICKET_LIST_SETTINGS と一致する", () => {
    const ctrl = new SettingsController(makeStore());
    const s = ctrl.getSettings();
    assert.deepStrictEqual(s.filters, DEFAULT_TICKET_LIST_SETTINGS.filters);
    assert.deepStrictEqual(s.sort, DEFAULT_TICKET_LIST_SETTINGS.sort);
    assert.deepStrictEqual(s.dueDate, DEFAULT_TICKET_LIST_SETTINGS.dueDate);
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
});
