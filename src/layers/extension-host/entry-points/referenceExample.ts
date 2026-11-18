import * as vscode from "vscode";
import { referenceExampleCommand } from "../../../contracts/referenceExample";
import { completeReferenceExample } from "../features/reference-example";

export function registerReferenceExample(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(referenceExampleCommand, async () => {
    const result = await completeReferenceExample();
    void vscode.window.showInformationMessage(vscode.l10n.t("Redmine reference example completed."));
    return result;
  }));
}
