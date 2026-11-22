import * as vscode from "vscode";
import type { CommandDeps } from "./commandRegistry";

export const registerListRefreshCommands = (
  context: vscode.ExtensionContext,
  { ticketsPresentation, commentsPresentation }: Pick<CommandDeps, "ticketsPresentation" | "commentsPresentation">,
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.refreshProjects", () =>
      ticketsPresentation.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.refreshTickets", () =>
      ticketsPresentation.refresh(),
    ),
    vscode.commands.registerCommand("redmine-client.refreshComments", () =>
      commentsPresentation.refresh(),
    ),
  );
};

export const registerProjectSelectionCommands = (
  context: vscode.ExtensionContext,
  { ticketsPresentation }: Pick<CommandDeps, "ticketsPresentation">,
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.reloadProject", async () => {
      ticketsPresentation.refresh();
    }),
    vscode.commands.registerCommand("redmine-client.selectProject", async () => {
      const projectId = await vscode.window.showInputBox({
        prompt: "Enter Redmine project ID",
        placeHolder: vscode.l10n.t("e.g. 123"),
      });
      if (!projectId) {
        return;
      }
      const numericId = Number(projectId);
      if (!Number.isSafeInteger(numericId) || numericId <= 0) {
        vscode.window.showErrorMessage(vscode.l10n.t("Project ID must be a number."));
        return;
      }
      try {
        await ticketsPresentation.setSelectedProjectId(numericId);
      } catch (err) {
        vscode.window.showErrorMessage(
          vscode.l10n.t("The selected project is not available: {0}", err instanceof Error ? err.message : String(err)),
        );
      }
    }),
    vscode.commands.registerCommand("redmine-client.toggleChildProjects", async () => {
      const config = vscode.workspace.getConfiguration("redmine-client");
      const current = config.get<boolean>("includeChildProjects", false);
      await config.update("includeChildProjects", !current, vscode.ConfigurationTarget.Global);
      ticketsPresentation.refresh();
    }),
  );
};
