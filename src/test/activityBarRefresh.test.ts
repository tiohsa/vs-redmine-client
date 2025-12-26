import * as assert from "assert";
import * as vscode from "vscode";
import { registerFocusRefresh } from "../views/viewFocusRefresh";

suite("Activity Bar refresh", () => {
  test("refreshes when the view becomes visible", () => {
    const emitter = new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>();
    const view = {
      onDidChangeVisibility: emitter.event,
    } as vscode.TreeView<unknown>;

    let refreshCount = 0;
    registerFocusRefresh(view, () => {
      refreshCount += 1;
    });

    emitter.fire({ visible: true } as vscode.TreeViewVisibilityChangeEvent);
    emitter.fire({ visible: false } as vscode.TreeViewVisibilityChangeEvent);

    assert.strictEqual(refreshCount, 1);
  });
});
