import * as vscode from "vscode";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { setApiKeyForScope, clearApiKey, getApiKeyStatus } from "../config/apiKeyStore";
import { showError, showSuccess } from "../utils/notifications";
import { assignEditorConnectionScope, isTicketEditor } from "../views/ticketEditorRegistry";
import type { CommandDeps } from "./commandRegistry";

export const registerConnectionCommands = (
  context: vscode.ExtensionContext,
  { settingsPresentation }: Pick<CommandDeps, "settingsPresentation">,
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.assignEditorToCurrentConnection", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTicketEditor(editor)) {
        showError(vscode.l10n.t("Open a Redmine editor before assigning its connection."));
        return;
      }
      assignEditorConnectionScope(editor);
      showSuccess(vscode.l10n.t("Editor assigned to the current Redmine connection."));
    }),
    vscode.commands.registerCommand("redmine-client.setApiKey", async () => {
      const connectionScope = getCurrentConnectionScope();
      const key = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Enter Redmine API key"),
        password: true,
        placeHolder: vscode.l10n.t("Redmine API key"),
      });
      if (key === undefined) {
        return;
      }
      await setApiKeyForScope(connectionScope, key);
      settingsPresentation.refresh();
      showSuccess(vscode.l10n.t("API key saved to secure storage."));
    }),
    vscode.commands.registerCommand("redmine-client.clearApiKey", async () => {
      await clearApiKey();
      settingsPresentation.refresh();
      showSuccess(vscode.l10n.t("API key removed."));
    }),
    vscode.commands.registerCommand("redmine-client.showApiKeyStatus", async () => {
      const status = await getApiKeyStatus();
      const messages: Record<typeof status, string> = {
        secret: vscode.l10n.t("API key is stored in secure storage."),
        none: vscode.l10n.t("API key is not configured."),
      };
      vscode.window.showInformationMessage(messages[status]);
    }),
  );
};
