import * as vscode from "vscode";
import { createTicketFromEditor } from "../commands/createTicket";
import { createChildTicketFromList } from "../commands/createChildTicketFromList";
import { createTicketFromList } from "../commands/createTicketFromList";
import { createTicketFromMarkdownHeader } from "../commands/createTicketFromMarkdownHeader";
import { focusTicketEditor } from "../commands/focusTicketEditor";
import { reloadTicketFromEditor } from "../commands/reloadTicket";
import { showError, showSuccess } from "../utils/notifications";
import { insertRedmineTicketFrontmatter } from "../commands/insertRedmineTicketFrontmatter";
import { VIEW_ID_DASHBOARD } from "../dashboard/dashboardProtocol";
import {
  CREATE_TICKET_FROM_MARKDOWN_HEADER_COMMAND,
  INSERT_REDMINE_TICKET_FRONTMATTER_COMMAND,
} from "./commandIds";
import { getTicketIdForEditor, isTicketEditor, NEW_TICKET_DRAFT_ID } from "../views/ticketEditorRegistry";
import { showTicketPreview } from "../views/ticketPreview";
import type { CommandDeps } from "./commandRegistry";
import { requireSelectedTicket } from "./dashboardCommandSelection";

export const registerTicketEditorCommands = (
  context: vscode.ExtensionContext,
  { commentsPresentation, dashboardProvider, ticketsPresentation }: Pick<CommandDeps, "commentsPresentation" | "dashboardProvider" | "ticketsPresentation">,
): void => {
  const getState = () => dashboardProvider.getStateSnapshot();
  const notifyTicketCreated = async (ticketId: number, connectionScope: string): Promise<void> => {
    if (ticketsPresentation.revealCreatedTickets) {
      await ticketsPresentation.revealCreatedTickets([ticketId], connectionScope);
    } else {
      ticketsPresentation.refresh();
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.searchTickets", async () => {
      try {
        await dashboardProvider.focusTicketSearch(() =>
          vscode.commands.executeCommand(`${VIEW_ID_DASHBOARD}.focus`),
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          error instanceof Error ? error.message : vscode.l10n.t("Could not focus the Dashboard search."),
        );
      }
    }),
    vscode.commands.registerCommand("redmine-client.focusTicketEditor", async (input: unknown) => {
      const payload = input as { ticketId?: number; uri?: string } | number | undefined;
      const ticketId = typeof payload === "number" ? payload : payload?.ticketId;
      if (!payload || (!ticketId && !(payload as { uri?: string })?.uri)) {
        showError(vscode.l10n.t("Select an open ticket to focus."));
        return;
      }
      await focusTicketEditor(payload);
      if (ticketId && ticketId !== NEW_TICKET_DRAFT_ID) {
        commentsPresentation.refreshForTicket(ticketId);
      }
    }),
    vscode.commands.registerCommand("redmine-client.revealActiveTicket", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTicketEditor(editor)) {
        showError(vscode.l10n.t("Open a ticket editor to focus its ticket."));
        return;
      }
      const ticketId = getTicketIdForEditor(editor);
      if (!ticketId || ticketId === NEW_TICKET_DRAFT_ID) {
        showError(vscode.l10n.t("New ticket drafts are not listed in the ticket tree."));
        return;
      }
      showSuccess(vscode.l10n.t("Ticket #{0} is active in the editor.", ticketId));
    }),
    vscode.commands.registerCommand("redmine-client.reloadTicket", async () => {
      if (await reloadTicketFromEditor()) {
        ticketsPresentation.notifyChange();
      }
    }),
    vscode.commands.registerCommand("redmine-client.createTicket", async () => {
      await createTicketFromEditor({ onTicketCreated: notifyTicketCreated });
    }),
    vscode.commands.registerCommand(CREATE_TICKET_FROM_MARKDOWN_HEADER_COMMAND, async () => {
      await createTicketFromMarkdownHeader({ onTicketCreated: notifyTicketCreated });
    }),
    vscode.commands.registerCommand(INSERT_REDMINE_TICKET_FRONTMATTER_COMMAND, async () => {
      await insertRedmineTicketFrontmatter();
    }),
    vscode.commands.registerCommand("redmine-client.createTicketFromList", async () => {
      await createTicketFromList();
    }),
    vscode.commands.registerCommand("redmine-client.createTicketFromDashboard", async () => {
      await dashboardProvider.createNewTicketDraft();
    }),
    vscode.commands.registerCommand("redmine-client.toggleCompactMode", () => {
      dashboardProvider.toggleCompactMode();
    }),
    vscode.commands.registerCommand("redmine-client.createChildTicketFromList", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard から親チケットを選択してください。");
      if (!selected) { return; }
      await createChildTicketFromList(selected);
    }),
  );
};

export const registerTicketPreviewCommands = (
  context: vscode.ExtensionContext,
  { commentsPresentation, dashboardProvider }: Pick<CommandDeps, "commentsPresentation" | "dashboardProvider">,
): void => {
  const getState = () => dashboardProvider.getStateSnapshot();

  context.subscriptions.push(
    vscode.commands.registerCommand("redmine-client.openTicketPreview", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard からチケットを選択してください。");
      if (!selected) { return; }
      await showTicketPreview(selected);
      commentsPresentation.refreshForTicket(selected.id);
    }),
    vscode.commands.registerCommand("redmine-client.openExtraTicketEditor", async () => {
      const selected = requireSelectedTicket(getState(), "Dashboard からチケットを選択してください。");
      if (!selected) { return; }
      await showTicketPreview(selected, { kind: "extra" });
      commentsPresentation.refreshForTicket(selected.id);
    }),
  );
};
