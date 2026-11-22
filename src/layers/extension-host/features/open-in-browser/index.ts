import * as vscode from "vscode";

interface BrowserIssueTarget {
  ticketId: number;
  commentId?: number;
}

interface BrowserIssueActions {
  isCurrentConnection(): boolean;
  findNoteIndex(ticketId: number, commentId: number): Promise<number | undefined>;
  openTicket(ticketId: number): Promise<void>;
  openComment(ticketId: number, commentId: number, noteIndex: number): Promise<void>;
  onError(message: string): void;
}

export async function openBrowserIssue(target: BrowserIssueTarget, actions: BrowserIssueActions): Promise<void> {
  const { ticketId, commentId } = target;
  const connectionChanged = () => actions.onError(vscode.l10n.t("The Redmine connection changed before opening the browser."));
  if (!actions.isCurrentConnection()) {
    connectionChanged();
    return;
  }
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
    actions.onError(vscode.l10n.t("Ticket ID is missing."));
    return;
  }
  if (commentId === undefined) {
    await actions.openTicket(ticketId);
    return;
  }

  if (!Number.isSafeInteger(commentId) || commentId <= 0) {
    actions.onError(vscode.l10n.t("Comment ID is missing."));
    return;
  }
  const noteIndex = await actions.findNoteIndex(ticketId, commentId);
  if (!actions.isCurrentConnection()) {
    connectionChanged();
    return;
  }
  if (noteIndex === undefined || !Number.isSafeInteger(noteIndex) || noteIndex <= 0) {
    actions.onError(vscode.l10n.t("Could not locate the comment in Redmine."));
    return;
  }
  await actions.openComment(ticketId, commentId, noteIndex);
}
