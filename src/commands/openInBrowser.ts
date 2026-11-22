import * as vscode from "vscode";
import { getConnectionScope } from "../config/connectionScope";
import { openBrowserIssue } from "../layers/extension-host/features/open-in-browser";
import { runWithConnectionScope } from "../redmine/client";
import { listComments } from "../redmine/comments";
import { getBaseUrl } from "../config/settings";
import { Project, Ticket, Comment } from "../redmine/types";
import { buildCommentUrl, buildProjectUrl, buildTicketUrl } from "../utils/redmineUrls";
import { showError } from "../utils/notifications";

type IssueBrowserOptions = {
  scope?: string;
  comments?: { ticketId?: number; items: readonly { id?: number; noteIndex?: number }[] };
};

type BrowserDeps = {
  baseUrl?: string;
  openExternal?: (uri: vscode.Uri) => Thenable<boolean>;
  onError?: (message: string) => void;
};

const openExternalUrl = async (
  url: string,
  openExternal: (uri: vscode.Uri) => Thenable<boolean> = vscode.env.openExternal,
): Promise<boolean> => {
  try {
    return await openExternal(vscode.Uri.parse(url));
  } catch {
    return false;
  }
};

const resolveErrors = (deps?: BrowserDeps): ((message: string) => void) =>
  deps?.onError ?? showError;

export const openProjectInBrowser = async (
  item?: { project: Project },
  deps?: BrowserDeps,
): Promise<void> => {
  const onError = resolveErrors(deps);
  const identifier = item?.project.identifier;
  if (!identifier) {
    onError("Project identifier is missing.");
    return;
  }

  const { url, errorMessage } = buildProjectUrl(
    deps?.baseUrl ?? getBaseUrl(),
    identifier,
  );
  if (!url) {
    onError(errorMessage ?? "Failed to build project URL.");
    return;
  }

  const opened = await openExternalUrl(url, deps?.openExternal);
  if (!opened) {
    onError("Failed to open browser.");
  }
};

export const openTicketInBrowser = async <T extends Pick<Ticket, "id">>(
  item?: { ticket: T },
  deps?: BrowserDeps,
): Promise<void> => {
  const onError = resolveErrors(deps);
  const ticketId = item?.ticket.id;
  if (!ticketId) {
    onError(vscode.l10n.t("Ticket ID is missing."));
    return;
  }

  const { url, errorMessage } = buildTicketUrl(
    deps?.baseUrl ?? getBaseUrl(),
    ticketId,
  );
  if (!url) {
    onError(vscode.l10n.t("Could not build the Redmine URL: {0}", errorMessage ?? ""));
    return;
  }

  const opened = await openExternalUrl(url, deps?.openExternal);
  if (!opened) {
    onError(vscode.l10n.t("Failed to open browser."));
  }
};

export const openCommentInBrowser = async <T extends Pick<Comment, "id" | "ticketId" | "noteIndex">>(
  item?: { comment: T },
  deps?: BrowserDeps,
): Promise<void> => {
  const onError = resolveErrors(deps);
  const ticketId = item?.comment.ticketId;
  const commentId = item?.comment.id;
  const noteIndex = item?.comment.noteIndex;
  if (!ticketId) {
    onError(vscode.l10n.t("Ticket ID is missing."));
    return;
  }
  if (!commentId) {
    onError(vscode.l10n.t("Comment ID is missing."));
    return;
  }

  const { url, errorMessage } = buildCommentUrl(
    deps?.baseUrl ?? getBaseUrl(),
    ticketId,
    noteIndex,
  );
  if (!url) {
    onError(vscode.l10n.t("Could not build the Redmine URL: {0}", errorMessage ?? ""));
    return;
  }

  const opened = await openExternalUrl(url, deps?.openExternal);
  if (!opened) {
    onError(vscode.l10n.t("Failed to open browser."));
  }
};

export async function openIssueInBrowser(
  target: { ticketId: number; commentId?: number },
  options: IssueBrowserOptions = {},
): Promise<void> {
  const currentScope = () => getConnectionScope(getBaseUrl());
  const scope = options.scope ?? currentScope();
  if (target.commentId !== undefined && scope === currentScope()) {
    const { errorMessage } = buildTicketUrl(scope, target.ticketId);
    if (errorMessage) {
      showError(vscode.l10n.t("Could not build the Redmine URL: {0}", errorMessage));
      return;
    }
  }
  let changed = false;
  const configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("redmine-client.baseUrl") && currentScope() !== scope) {
      changed = true;
    }
  });
  try {
    const browserDeps: BrowserDeps = { baseUrl: scope };
    await openBrowserIssue(target, {
      isCurrentConnection: () => !changed && currentScope() === scope,
      onError: showError,
      findNoteIndex: async (ticketId, commentId) => {
        const comments = options.comments;
        const noteIndex = comments?.ticketId === ticketId
          ? comments.items.find((item) => item.id === commentId)?.noteIndex
          : undefined;
        if (noteIndex !== undefined && Number.isSafeInteger(noteIndex) && noteIndex > 0) {
          return noteIndex;
        }
        try {
          const remoteComments = await runWithConnectionScope(scope, () => listComments(ticketId));
          return remoteComments.find((item) => item.ticketId === ticketId && item.id === commentId)?.noteIndex;
        } catch {
          return undefined;
        }
      },
      openTicket: (ticketId) => openTicketInBrowser({ ticket: { id: ticketId } }, browserDeps),
      openComment: (ticketId, commentId, noteIndex) => openCommentInBrowser({
        comment: { id: commentId, ticketId, noteIndex },
      }, browserDeps),
    });
  } finally {
    configurationListener.dispose();
  }
}
