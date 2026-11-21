import * as path from "path";
import * as vscode from "vscode";
import { openCommentInBrowser, openProjectInBrowser, openTicketInBrowser } from "../commands/openInBrowser";
import {
  getTicketIdForEditor,
  getTicketIdForUri,
  isTicketEditor,
  NEW_TICKET_DRAFT_ID,
} from "../views/ticketEditorRegistry";
import {
  isNewTicketDraftFilename,
  parseDirectTicketFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "../views/editorFilename";
import type { Project } from "../redmine/types";
import {
  EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
  editTicketFieldViaQuickPick,
  type TicketQuickPickField,
} from "../views/ticketCodeLensProvider";
import type { CommandDeps } from "./commandRegistry";
import { toSelectedTicket, pickDashboardComment } from "./dashboardCommandSelection";

export const registerBrowserCommands = (
  context: vscode.ExtensionContext,
  { dashboardProvider }: Pick<CommandDeps, "dashboardProvider">,
): void => {
  const getState = () => dashboardProvider.getStateSnapshot();

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.openProjectInBrowser", async () => {
      const selected = getState().selectedProject;
      if (!selected?.id || !selected.name || !selected.identifier) {
        vscode.window.showErrorMessage(vscode.l10n.t("Select a project in Dashboard."));
        return;
      }
      const project: Project = { id: selected.id, name: selected.name, identifier: selected.identifier };
      await openProjectInBrowser({ project });
    }),
    vscode.commands.registerCommand("redmine-client.openTicketInBrowser", async (uriArg?: unknown) => {
      if (uriArg instanceof vscode.Uri) {
        const filename = path.basename(uriArg.path);
        const registeredId = getTicketIdForUri(uriArg);
        const parsedEditor = parseEditorFilename(filename);
        const uriTicketId =
          registeredId ??
          parseDirectTicketFilename(filename) ??
          parseNewCommentDraftFilename(filename) ??
          parsedEditor?.ticketId;
        if (uriTicketId === NEW_TICKET_DRAFT_ID || isNewTicketDraftFilename(filename)) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("Cannot open an unsynced new ticket draft in the browser."),
          );
          return;
        }
        if (uriTicketId && uriTicketId > 0) {
          await openTicketInBrowser({
            ticket: {
              id: uriTicketId,
              subject: "",
              projectId: 0,
            },
          });
          return;
        }
      }
      const selected = toSelectedTicket(getState());
      if (selected) {
        await openTicketInBrowser({ ticket: selected });
        return;
      }
      const activeEditor = vscode.window.activeTextEditor;
      const activeTicketId = activeEditor && isTicketEditor(activeEditor)
        ? getTicketIdForEditor(activeEditor)
        : undefined;
      if (activeTicketId === NEW_TICKET_DRAFT_ID) {
        vscode.window.showErrorMessage(
          vscode.l10n.t("Cannot open an unsynced new ticket draft in the browser."),
        );
        return;
      }
      if (activeTicketId && activeTicketId > 0) {
        await openTicketInBrowser({
          ticket: {
            id: activeTicketId,
            subject: "",
            projectId: 0,
          },
        });
        return;
      }
      vscode.window.showErrorMessage("Dashboard でチケットを選択してください。");
    }),
    vscode.commands.registerCommand(
      EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
      async (uriOrField?: vscode.Uri | string, field?: TicketQuickPickField) => {
        await editTicketFieldViaQuickPick(uriOrField, field);
      },
    ),
    vscode.commands.registerCommand("redmine-client.openCommentInBrowser", async () => {
      const comment = await pickDashboardComment(getState());
      if (!comment) {
        vscode.window.showErrorMessage(vscode.l10n.t("Select a comment in Dashboard."));
        return;
      }
      await openCommentInBrowser({ comment });
    }),
  );
};
