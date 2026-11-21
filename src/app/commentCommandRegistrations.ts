import * as vscode from "vscode";
import { addCommentFromList } from "../commands/addCommentFromList";
import { editComment } from "../commands/editComment";
import { reloadCommentFromEditor } from "../commands/reloadComment";
import type { CommandDeps } from "./commandRegistry";
import { pickDashboardComment } from "./dashboardCommandSelection";
import { registerStubMessage } from "./registerCommandStub";

export const registerCommentCommands = (
  context: vscode.ExtensionContext,
  { dashboardProvider }: Pick<CommandDeps, "dashboardProvider">,
): void => {
  const getState = () => dashboardProvider.getStateSnapshot();

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.reloadComment", async () => {
      await reloadCommentFromEditor();
    }),
    vscode.commands.registerCommand("redmine-client.editComment", async () => {
      const comment = await pickDashboardComment(getState());
      if (!comment) {
        vscode.window.showErrorMessage(vscode.l10n.t("Select a comment in Dashboard before running."));
        return;
      }
      await editComment(comment);
    }),
    registerStubMessage(
      "redmine-client.addComment",
      "Dashboard からチケットを選択してコメントを追加してください。",
    ),
    vscode.commands.registerCommand("redmine-client.addCommentFromComments", async () => {
      const ticketId = getState().selectedTicketId;
      await addCommentFromList(ticketId);
    }),
  );
};
