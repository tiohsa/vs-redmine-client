import * as vscode from "vscode";
import { getBaseUrl } from "../config/settings";
import { Project, Ticket, Comment } from "../redmine/types";
import { buildCommentUrl, buildProjectUrl, buildTicketUrl } from "../utils/redmineUrls";
import { showError } from "../utils/notifications";

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

export const openTicketInBrowser = async (
  item?: { ticket: Ticket },
  deps?: BrowserDeps,
): Promise<void> => {
  const onError = resolveErrors(deps);
  const ticketId = item?.ticket.id;
  if (!ticketId) {
    onError("Ticket ID is missing.");
    return;
  }

  const { url, errorMessage } = buildTicketUrl(
    deps?.baseUrl ?? getBaseUrl(),
    ticketId,
  );
  if (!url) {
    onError(errorMessage ?? "Failed to build ticket URL.");
    return;
  }

  const opened = await openExternalUrl(url, deps?.openExternal);
  if (!opened) {
    onError("Failed to open browser.");
  }
};

export const openCommentInBrowser = async (
  item?: { comment: Comment },
  deps?: BrowserDeps,
): Promise<void> => {
  const onError = resolveErrors(deps);
  const ticketId = item?.comment.ticketId;
  const commentId = item?.comment.id;
  const noteIndex = item?.comment.noteIndex;
  if (!ticketId) {
    onError("Ticket ID is missing.");
    return;
  }
  if (!commentId) {
    onError("Comment ID is missing.");
    return;
  }

  const { url, errorMessage } = buildCommentUrl(
    deps?.baseUrl ?? getBaseUrl(),
    ticketId,
    commentId,
    noteIndex,
  );
  if (!url) {
    onError(errorMessage ?? "Failed to build comment URL.");
    return;
  }

  const opened = await openExternalUrl(url, deps?.openExternal);
  if (!opened) {
    onError("Failed to open browser.");
  }
};
