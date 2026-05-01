import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { loadPackageJson, getCommands } from "./helpers/packageJson";

suite("0.1.3 安定化: パッケージ・README サニティチェック", () => {
  test("publisher が placeholder ではない", () => {
    const pkg = loadPackageJson();
    const publisher = pkg["publisher"] as string | undefined;
    assert.ok(publisher, "publisher が設定されていること");
    assert.notStrictEqual(publisher, "your-publisher-id", "publisher が placeholder ではないこと");
  });

  test("collapseAllProjects コマンドが contributes.commands に存在しない", () => {
    const commands = getCommands();
    const found = commands.some((c) => c.command === "redmine-client.collapseAllProjects");
    assert.strictEqual(found, false, "collapseAllProjects はユーザー向けコマンドとして残っていないこと");
  });

  test("collapseAllTickets コマンドが contributes.commands に存在しない", () => {
    const commands = getCommands();
    const found = commands.some((c) => c.command === "redmine-client.collapseAllTickets");
    assert.strictEqual(found, false, "collapseAllTickets はユーザー向けコマンドとして残っていないこと");
  });

  test("README に Open Editors view の現行機能説明が含まれない", () => {
    const readmePath = path.resolve(__dirname, "../../../README.md");
    const readme = fs.readFileSync(readmePath, "utf8");
    const hasOldEditorView = readme.includes("**Open Editors**") &&
      readme.includes("List all currently open ticket");
    assert.strictEqual(
      hasOldEditorView,
      false,
      "README が旧 TreeView ベースの Open Editors 説明を含まないこと",
    );
  });

  test("README に Dashboard Webview の説明が含まれる", () => {
    const readmePath = path.resolve(__dirname, "../../../README.md");
    const readme = fs.readFileSync(readmePath, "utf8");
    assert.ok(
      readme.includes("Dashboard"),
      "README に Dashboard の記述があること",
    );
  });

  test("syncToRedmine コマンドが package.json に存在する", () => {
    const commands = getCommands();
    const found = commands.some((c) => c.command === "redmine-client.syncToRedmine");
    assert.strictEqual(found, true, "syncToRedmine コマンドが存在すること");
  });
});
