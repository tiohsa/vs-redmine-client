import * as assert from "assert";
import * as vscode from "vscode";
import { SettingsController } from "../dashboard/SettingsController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DEFAULT_TICKET_LIST_SETTINGS } from "../views/projectListSettings";
import { type EditorDefaultField } from "../config/settings";
import { isApiKeyConfigured } from "../config/apiKeyStore";
import {
  getTicketEditorDefaults,
  resetTicketEditorDefaults,
  updateTicketEditorDefaultField,
} from "../views/ticketEditorDefaultsStore";
import { initializeTicketListSettingsStore } from "../views/ticketListSettingsStore";
import { normalizeEditorDefaultValue } from "../views/ticketEditorDefaultsValidation";

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

  test("Editor Default は入力経路によらず共通ルールで正規化される", () => {
    const cases: Array<[EditorDefaultField, string, string]> = [
      ["subject", "  test  ", "test"],
      ["tracker", "  Bug  ", "Bug"],
      ["priority", " Normal ", "Normal"],
      ["status", " New ", "New"],
      ["due_date", " 2026-09-30 ", "2026-09-30"],
      ["description", "  first line\nsecond line  ", "  first line\nsecond line  "],
    ];
    const ctrl = new SettingsController(makeStore());

    for (const [field, rawValue, expected] of cases) {
      assert.strictEqual(normalizeEditorDefaultValue(field, rawValue), expected);
      ctrl.updateEditorDefault(field, rawValue);
      const defaults = getTicketEditorDefaults();
      const actual = field === "subject"
        ? defaults.subject
        : field === "description"
          ? defaults.description
          : defaults.metadata[field];
      assert.strictEqual(actual, expected);
    }
  });

  test("resetDisplaySettings は表示設定だけを既定値へ戻す", async () => {
    const config = vscode.workspace.getConfiguration("redmine-client");
    const untouchedKeys = [
      "baseUrl",
      "defaultProjectId",
      "requestTimeoutMs",
      "ignoreSSLErrors",
      "offlineSyncMode",
      "editorStorageDirectory",
      "selectedProjectId",
      "selectedProjectName",
    ];
    const untouchedValues = new Map(
      untouchedKeys.map((key) => [key, config.get<unknown>(key)] as const),
    );
    const apiKeyConfigured = isApiKeyConfigured();
    await config.update("includeChildProjects", true, vscode.ConfigurationTarget.Global);
    await config.update("ticketListLimit", 100, vscode.ConfigurationTarget.Global);
    await config.update("ticketList.showStatus", false, vscode.ConfigurationTarget.Global);
    await config.update("ticketList.showDueDate", false, vscode.ConfigurationTarget.Global);
    await config.update("ticketList.showTracker", false, vscode.ConfigurationTarget.Global);
    await config.update("ticketList.showPriority", false, vscode.ConfigurationTarget.Global);
    await config.update("ticketList.showAssignee", false, vscode.ConfigurationTarget.Global);

    const ctrl = new SettingsController(makeStore());
    ctrl.updateTicketList({
      filters: { ...DEFAULT_TICKET_LIST_SETTINGS.filters, subjectQuery: "changed" },
      sort: { field: "priority", direction: "desc" },
      dueDate: { ...DEFAULT_TICKET_LIST_SETTINGS.dueDate, showOverdue: false },
    });
    ctrl.updateEditorDefault("subject", "Keep this default");

    await ctrl.resetDisplaySettings();

    assert.deepStrictEqual(ctrl.getSettings(), DEFAULT_TICKET_LIST_SETTINGS);
    const resetConfig = vscode.workspace.getConfiguration("redmine-client");
    for (const key of [
      "includeChildProjects",
      "ticketListLimit",
      "ticketList.showStatus",
      "ticketList.showDueDate",
      "ticketList.showTracker",
      "ticketList.showPriority",
      "ticketList.showAssignee",
    ]) {
      const inspected = resetConfig.inspect<unknown>(key);
      assert.strictEqual(resetConfig.get<unknown>(key), inspected?.defaultValue);
    }
    for (const key of untouchedKeys) {
      assert.strictEqual(config.get<unknown>(key), untouchedValues.get(key));
    }
    assert.strictEqual(isApiKeyConfigured(), apiKeyConfigured);
    assert.strictEqual(getTicketEditorDefaults().subject, "Keep this default");
  });

  test("resetDisplaySettings は Global のみ削除し Workspace / WorkspaceFolder を保持する", async () => {
    const config = vscode.workspace.getConfiguration("redmine-client");
    const hasWorkspaceFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (!hasWorkspaceFolder) {
      // .vscode-test.mjs の標準実行は workspace を開かないため、scope 書き込みを検証できない。
      return;
    }
    const previousValues = new Map<string, unknown>();
    const previousWorkspaceFolderValue = config.inspect<unknown>("ticketList.showStatus")?.workspaceFolderValue;
    const previousWorkspaceValue = config.inspect<unknown>("ticketListLimit")?.workspaceValue;
    const previousGlobalLimitValue = config.inspect<unknown>("ticketListLimit")?.globalValue;
    const previousGlobalStatusValue = config.inspect<unknown>("ticketList.showStatus")?.globalValue;

    previousValues.set("ticketListLimit.workspace", previousWorkspaceValue);
    previousValues.set("ticketListLimit.global", previousGlobalLimitValue);
    previousValues.set("ticketList.showStatus.global", previousGlobalStatusValue);
    if (hasWorkspaceFolder) {
      previousValues.set("ticketList.showStatus.workspaceFolder", previousWorkspaceFolderValue);
    }

    try {
      await config.update("ticketListLimit", 100, vscode.ConfigurationTarget.Global);
      await config.update("ticketListLimit", 200, vscode.ConfigurationTarget.Workspace);
      await config.update("ticketList.showStatus", false, vscode.ConfigurationTarget.Global);
      if (hasWorkspaceFolder) {
        await config.update("ticketList.showStatus", false, vscode.ConfigurationTarget.WorkspaceFolder);
      }

      await new SettingsController(makeStore()).resetDisplaySettings();

      const limitInspection = config.inspect<unknown>("ticketListLimit");
      assert.strictEqual(limitInspection?.globalValue, undefined);
      assert.strictEqual(limitInspection?.workspaceValue, 200);
      assert.strictEqual(config.get<unknown>("ticketListLimit"), 200);

      const statusInspection = config.inspect<unknown>("ticketList.showStatus");
      assert.strictEqual(statusInspection?.globalValue, undefined);
      if (hasWorkspaceFolder) {
        assert.strictEqual(statusInspection?.workspaceFolderValue, false);
      }
    } finally {
      await config.update(
        "ticketListLimit",
        previousValues.get("ticketListLimit.workspace"),
        vscode.ConfigurationTarget.Workspace,
      );
      await config.update(
        "ticketListLimit",
        previousValues.get("ticketListLimit.global"),
        vscode.ConfigurationTarget.Global,
      );
      await config.update(
        "ticketList.showStatus",
        previousValues.get("ticketList.showStatus.global"),
        vscode.ConfigurationTarget.Global,
      );
      if (hasWorkspaceFolder) {
        await config.update(
          "ticketList.showStatus",
          previousValues.get("ticketList.showStatus.workspaceFolder"),
          vscode.ConfigurationTarget.WorkspaceFolder,
        );
      }
    }
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

  test("pushSettings: 表示設定が store の settings に含まれる", () => {
    const store = makeStore();
    const ctrl = new SettingsController(store);
    ctrl.pushSettings();
    const s = store.getState().settings;
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showStatus"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showDueDate"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showTracker"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showPriority"));
    assert.ok(Object.prototype.hasOwnProperty.call(s, "showAssignee"));
  });

  test("updateGeneral: トラッカー・優先度・担当者の表示設定を更新できる", async () => {
    const config = vscode.workspace.getConfiguration("redmine-client");
    const keys = ["ticketList.showTracker", "ticketList.showPriority", "ticketList.showAssignee"] as const;
    const previous = new Map(
      keys.map((key) => [key, config.inspect<unknown>(key)?.globalValue] as const),
    );

    try {
      await new SettingsController(makeStore()).updateGeneral({
        showTracker: false,
        showPriority: false,
        showAssignee: false,
      });
      assert.strictEqual(config.inspect<boolean>(keys[0])?.globalValue, false);
      assert.strictEqual(config.inspect<boolean>(keys[1])?.globalValue, false);
      assert.strictEqual(config.inspect<boolean>(keys[2])?.globalValue, false);
      const restored = makeStore();
      new SettingsController(restored);
      assert.strictEqual(restored.getState().settings.showAssignee, false);
    } finally {
      for (const key of keys) {
        await config.update(key, previous.get(key), vscode.ConfigurationTarget.Global);
      }
    }
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
