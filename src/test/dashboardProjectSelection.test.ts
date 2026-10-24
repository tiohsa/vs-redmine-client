import * as assert from "assert";
import * as vscode from "vscode";
import { clearProjectSelection, getProjectSelection, setProjectSelection } from "../config/projectSelection";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { DashboardProjectService } from "../dashboard/services/DashboardProjectService";

const createService = () => {
  const store = new DashboardStateStore();
  let projects = [{ id: 1, name: "Alpha", identifier: "alpha", level: 0 }, { id: 2, name: "Beta", identifier: "beta", level: 0 }];
  const service = new DashboardProjectService({
    context: {
      store, notifyOperationStarted: () => undefined, notifySuccess: () => undefined,
      notifyError: () => undefined, notifyToast: () => undefined, onTicketsRefreshed: () => undefined,
    },
    getProjects: () => projects,
    setProjects: next => { projects = next.map(project => ({ ...project, identifier: project.identifier ?? "" })); },
    resetTickets: project => store.update({ selectedProject: project }),
    loadTickets: async () => undefined,
  });
  return service;
};

suite("Dashboard プロジェクト選択の永続化", () => {
  const keys = ["selectedProjectId", "selectedProjectName", "defaultProjectId"] as const;
  const previous = new Map<string, string | undefined>();
  const update = (key: string, value: string | undefined) => vscode.workspace.getConfiguration("redmine-client")
    .update(key, value, vscode.ConfigurationTarget.Global);

  suiteSetup(() => {
    for (const key of keys) {
      previous.set(key, vscode.workspace.getConfiguration("redmine-client").inspect<string>(key)?.globalValue);
    }
  });
  setup(async () => {
    await clearProjectSelection();
    await update("defaultProjectId", "1");
  });
  suiteTeardown(async () => {
    for (const key of keys) { await update(key, previous.get(key)); }
  });

  test("保存済みプロジェクトから全プロジェクトへ切り替えた状態を再生成後も復元する", async () => {
    await setProjectSelection(2, "Beta");
    const service = createService();
    assert.strictEqual(service.getResolvedProject()?.id, 2);
    await service.selectProject();
    assert.strictEqual(service.getResolvedProject(), undefined);
    assert.deepStrictEqual(getProjectSelection(), { allProjects: true });
    assert.strictEqual(vscode.workspace.getConfiguration("redmine-client").get("selectedProjectName"), "");
    assert.strictEqual(createService().getResolvedProject(), undefined, "数字の既定プロジェクトへ戻らない");
    await update("defaultProjectId", "alpha");
    assert.strictEqual(createService().getResolvedProject(), undefined, "identifier の既定プロジェクトへも戻らない");
  });

  test("未設定と従来の保存済みIDは従来どおり解決し、明示的な全選択と区別する", async () => {
    assert.strictEqual(createService().getResolvedProject()?.id, 1);
    await setProjectSelection(2, "Beta");
    assert.deepStrictEqual(createService().getResolvedProject(), { id: 2, name: "Beta" });
    await update("selectedProjectId", "invalid");
    assert.strictEqual(createService().getResolvedProject()?.id, 1);
    await createService().selectProject();
    await clearProjectSelection();
    assert.strictEqual(createService().getResolvedProject()?.id, 1);
  });

  test("全プロジェクトから通常プロジェクトへ戻した選択も再生成後に復元する", async () => {
    const service = createService();
    await service.selectProject();
    await service.selectProject(2);
    assert.deepStrictEqual(getProjectSelection(), { id: 2, name: "Beta" });
    assert.deepStrictEqual(createService().getResolvedProject(), { id: 2, name: "Beta" });
  });

  test("連続した範囲変更は要求順に保存し、接続切替では全プロジェクトの選択も消去する", async () => {
    const service = createService();
    await Promise.all([service.selectProject(2), service.selectProject(), service.selectProject(1)]);
    assert.deepStrictEqual(getProjectSelection(), { id: 1, name: "Alpha" });
    await service.selectProject();
    await service.resetForConnectionChange();
    assert.strictEqual(getProjectSelection().allProjects, undefined);
    assert.strictEqual(getProjectSelection().id, undefined);
    assert.strictEqual(createService().getResolvedProject()?.id, 1);
  });
});
