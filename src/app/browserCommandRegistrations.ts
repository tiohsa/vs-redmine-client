import * as vscode from "vscode";
import { openIssueInBrowser, openProjectInBrowser } from "../commands/openInBrowser";
import { getCurrentConnectionScope } from "../config/connectionScope";
import type { Project } from "../redmine/types";
import {
  OPEN_IN_BROWSER_COMMAND,
  OPEN_TICKET_IN_BROWSER_COMMAND,
  OPEN_COMMENT_IN_BROWSER_COMMAND,
} from "./commandIds";
import { browserTargetForDashboard, browserTargetForEditor, browserTargetForUri, type EditorBrowserTarget } from "./browserCommandTarget";
import {
  EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
  editTicketFieldViaQuickPick,
  type TicketQuickPickField,
} from "../views/ticketCodeLensProvider";
import type { DashboardWebviewProvider } from "../dashboard/DashboardWebviewProvider";
import { NEW_TICKET_DRAFT_ID } from "../views/ticketEditorRegistry";
import { pickDashboardComment } from "./dashboardCommandSelection";

export const registerBrowserCommands = (
  context: Pick<vscode.ExtensionContext, "subscriptions">,
  { dashboardProvider }: { dashboardProvider: Pick<DashboardWebviewProvider, "getStateSnapshot"> },
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
    vscode.commands.registerCommand(OPEN_IN_BROWSER_COMMAND, async (uriArg?: unknown) => {
      const scope = getCurrentConnectionScope();
      if (uriArg !== undefined && !(uriArg instanceof vscode.Uri)) {
        showSelectTarget();
        return;
      }
      const editorTarget = uriArg
        ? browserTargetForUri(uriArg, scope)
        : browserTargetForEditor(vscode.window.activeTextEditor, scope);
      if (uriArg || editorTarget) {
        await openEditorTarget(editorTarget, scope);
        return;
      }
      const state = getState();
      const target = browserTargetForDashboard(state);
      if (!target) {
        showSelectTarget();
        return;
      }
      await openIssueInBrowser(target, { scope, comments: state.comments });
    }),
    vscode.commands.registerCommand(OPEN_TICKET_IN_BROWSER_COMMAND, async (uriArg?: unknown) => {
      const scope = getCurrentConnectionScope();
      const editorTarget = uriArg instanceof vscode.Uri ? browserTargetForUri(uriArg, scope) : undefined;
      if (editorTarget) {
        await openEditorTarget(editorTarget, scope, true);
        return;
      }
      const ticketId = getState().selectedTicketId;
      if (ticketId) {
        await openIssueInBrowser({ ticketId }, { scope });
        return;
      }
      await openEditorTarget(browserTargetForEditor(vscode.window.activeTextEditor, scope), scope, true);
    }),
    vscode.commands.registerCommand(
      EDIT_FIELD_VIA_QUICK_PICK_COMMAND,
      async (uriOrField?: vscode.Uri | string, field?: TicketQuickPickField) => {
        await editTicketFieldViaQuickPick(uriOrField, field);
      },
    ),
    vscode.commands.registerCommand(OPEN_COMMENT_IN_BROWSER_COMMAND, async () => {
      const state = getState();
      if (!state.comments.ticketId || !state.comments.items.some((item) => item.id !== undefined)) {
        vscode.window.showErrorMessage(vscode.l10n.t("Select a comment in Dashboard."));
        return;
      }
      const scope = getCurrentConnectionScope();
      const comment = await pickDashboardComment(state);
      if (comment) {
        await openIssueInBrowser(
          { ticketId: comment.ticketId, commentId: comment.id },
          { scope, comments: state.comments },
        );
      }
    }),
  );

  async function openEditorTarget(editorTarget: EditorBrowserTarget | undefined, scope: string, ticketOnly = false): Promise<void> {
    if (!editorTarget) {
      showSelectTarget();
      return;
    }
    if (editorTarget.connectionScope !== scope) {
      vscode.window.showErrorMessage(vscode.l10n.t("This editor belongs to another Redmine connection."));
      return;
    }
    if (editorTarget.ticketId === NEW_TICKET_DRAFT_ID) {
      vscode.window.showErrorMessage(vscode.l10n.t("Cannot open an unsynced new ticket draft in the browser."));
      return;
    }
    const { ticketId, commentId } = editorTarget;
    await openIssueInBrowser(
      { ticketId, commentId: ticketOnly ? undefined : commentId },
      { scope, comments: getState().comments },
    );
  }
};

function showSelectTarget(): void {
  vscode.window.showErrorMessage(vscode.l10n.t("Open a Redmine editor or select a ticket in Dashboard."));
}
