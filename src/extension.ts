import * as vscode from "vscode";
import { addCommentForIssue } from "./commands/addComment";
import { createTicketFromEditor } from "./commands/createTicket";
import { editComment } from "./commands/editComment";
import { setProjectSelection, getProjectSelection } from "./config/projectSelection";
import { getIssueDetail } from "./redmine/issues";
import { showError, showSuccess, showWarning } from "./utils/notifications";
import { setCommentDraft } from "./views/commentDraftStore";
import { CommentTreeItem, CommentsTreeProvider } from "./views/commentsView";
import { ProjectTreeItem, ProjectsTreeProvider } from "./views/projectsView";
import { TicketTreeItem, TicketsTreeProvider } from "./views/ticketsView";
import {
  getEditorContentType,
  getTicketIdForEditor,
  isTicketEditor,
  markEditorActive,
  removeTicketEditorByDocument,
} from "./views/ticketEditorRegistry";
import { showTicketComment, showTicketPreview } from "./views/ticketPreview";
import { getCommentSaveNotification } from "./views/commentSaveNotifications";
import { handleCommentEditorSave } from "./views/commentSaveSync";
import { getSaveNotification } from "./views/ticketSaveNotifications";
import { handleTicketEditorSave } from "./views/ticketSaveSync";
import { registerFocusRefresh } from "./views/viewFocusRefresh";
import {
  VIEW_ID_ACTIVITY_COMMENTS,
  VIEW_ID_ACTIVITY_PROJECTS,
  VIEW_ID_ACTIVITY_TICKETS,
  VIEW_ID_EXPLORER_COMMENTS,
  VIEW_ID_EXPLORER_PROJECTS,
  VIEW_ID_EXPLORER_TICKETS,
} from "./views/viewIds";

export async function activate(context: vscode.ExtensionContext) {
  const ticketsProvider = new TicketsTreeProvider();
  const commentsProvider = new CommentsTreeProvider();
  const projectsProvider = new ProjectsTreeProvider();
  const projectsView = vscode.window.createTreeView(VIEW_ID_EXPLORER_PROJECTS, {
    treeDataProvider: projectsProvider,
  });
  const ticketsView = vscode.window.createTreeView(VIEW_ID_EXPLORER_TICKETS, {
    treeDataProvider: ticketsProvider,
  });
  const commentsView = vscode.window.createTreeView(VIEW_ID_EXPLORER_COMMENTS, {
    treeDataProvider: commentsProvider,
  });
  const activityProjectsView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_PROJECTS,
    {
      treeDataProvider: projectsProvider,
    },
  );
  const activityTicketsView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_TICKETS,
    {
      treeDataProvider: ticketsProvider,
    },
  );
  const activityCommentsView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_COMMENTS,
    {
      treeDataProvider: commentsProvider,
    },
  );
  let selectedComment: CommentTreeItem | undefined;
  let selectedCommentDocumentUri: string | undefined;
  context.subscriptions.push(
    projectsView,
    ticketsView,
    commentsView,
    activityProjectsView,
    activityTicketsView,
    activityCommentsView,
    registerFocusRefresh(activityProjectsView, () => projectsProvider.refresh()),
    registerFocusRefresh(activityTicketsView, () => ticketsProvider.refresh()),
    registerFocusRefresh(activityCommentsView, () => commentsProvider.refresh()),
  );

  const getSelectedComment = (item?: CommentTreeItem): CommentTreeItem | undefined => {
    return (
      item ??
      (commentsView.selection[0] as CommentTreeItem | undefined) ??
      (activityCommentsView.selection[0] as CommentTreeItem | undefined) ??
      selectedComment
    );
  };

  const handleTicketSelection = (item?: TicketTreeItem): void => {
    const selected = item ?? (ticketsView.selection[0] as TicketTreeItem | undefined);
    if (!selected || !(selected instanceof TicketTreeItem)) {
      return;
    }

    commentsProvider.setTicketId(selected.ticket.id);
  };

  const handleCommentSelection = async (item?: CommentTreeItem): Promise<void> => {
    const selected = getSelectedComment(item);
    if (!selected || !(selected instanceof CommentTreeItem)) {
      return;
    }

    selectedComment = selected;
    try {
      const detail = await getIssueDetail(selected.comment.ticketId);
      commentsProvider.setTicketId(detail.ticket.id);
      setCommentDraft(detail.ticket.id, selected.comment.body);
      const editor = await showTicketComment(
        detail.ticket,
        selected.comment.body,
        selected.comment.id,
      );
      selectedCommentDocumentUri = editor.document.uri.toString();
    } catch (error) {
      vscode.window.showErrorMessage((error as Error).message);
    }
  };

  let previousActiveEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (previousActiveEditor && isTicketEditor(previousActiveEditor)) {
        const ticketId = getTicketIdForEditor(previousActiveEditor);
        const contentType = getEditorContentType(previousActiveEditor);
        if (ticketId && contentType === "comment") {
          const draft = previousActiveEditor.document.getText();
          setCommentDraft(ticketId, draft);
        }
      }

      if (editor) {
        markEditorActive(editor);
      }

      previousActiveEditor = editor;
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      removeTicketEditorByDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      const document = event.document;
      const editor =
        vscode.window.visibleTextEditors.find((candidate) => candidate.document === document) ??
        (vscode.window.activeTextEditor?.document === document
          ? vscode.window.activeTextEditor
          : undefined);
      if (!editor) {
        return;
      }
      void (async () => {
        const result = await handleTicketEditorSave(editor);
        if (result) {
          const notification = getSaveNotification(result);
          if (!notification) {
            return;
          }

          if (notification.type === "info") {
            showSuccess(notification.message);
          } else if (notification.type === "warning") {
            showWarning(notification.message);
          } else {
            showError(notification.message);
          }
          return;
        }

        const commentResult = await handleCommentEditorSave(editor);
        if (!commentResult) {
          return;
        }

        const commentNotification = getCommentSaveNotification(commentResult);
        if (!commentNotification) {
          return;
        }

        if (commentNotification.type === "info") {
          showSuccess(commentNotification.message);
        } else if (commentNotification.type === "warning") {
          showWarning(commentNotification.message);
        } else {
          showError(commentNotification.message);
        }
      })();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.refreshProjects", () =>
      projectsProvider.refresh(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.refreshTickets", () =>
      ticketsProvider.refresh(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.selectProject", async () => {
      const projectId = await vscode.window.showInputBox({
        prompt: "Enter Redmine project ID",
        placeHolder: "e.g. 123",
      });

      if (!projectId) {
        return;
      }

      const numericId = Number(projectId);
      if (Number.isNaN(numericId)) {
        vscode.window.showErrorMessage("Project ID must be a number.");
        return;
      }

      await setProjectSelection(numericId, "");
      projectsProvider.setSelectedProjectId(numericId);
      ticketsProvider.setSelectedProjectId(numericId);
      ticketsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.toggleChildProjects", async () => {
      const config = vscode.workspace.getConfiguration("todoex");
      const current = config.get<boolean>("includeChildProjects", false);
      await config.update(
        "includeChildProjects",
        !current,
        vscode.ConfigurationTarget.Global,
      );
      ticketsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.openTicketPreview",
      async (item?: TicketTreeItem) => {
        const selected = item ?? (ticketsView.selection[0] as TicketTreeItem | undefined);
        if (!selected || !(selected instanceof TicketTreeItem)) {
          vscode.window.showErrorMessage("Select a ticket to preview.");
          return;
        }

        commentsProvider.setTicketId(selected.ticket.id);
        await showTicketPreview(selected.ticket);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.openExtraTicketEditor",
      async (item?: TicketTreeItem) => {
        const selected = item ?? (ticketsView.selection[0] as TicketTreeItem | undefined);
        if (!selected || !(selected instanceof TicketTreeItem)) {
          vscode.window.showErrorMessage("Select a ticket to preview.");
          return;
        }

        commentsProvider.setTicketId(selected.ticket.id);
        await showTicketPreview(selected.ticket, { kind: "extra" });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.createTicket", async () => {
      await createTicketFromEditor();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.editComment",
      async (item?: CommentTreeItem) => {
        const selected = getSelectedComment(item);
        if (!selected || !(selected instanceof CommentTreeItem)) {
          vscode.window.showErrorMessage("Select a comment to edit.");
          return;
        }

        if (
          selectedCommentDocumentUri &&
          vscode.window.activeTextEditor?.document?.uri.toString() !==
            selectedCommentDocumentUri
        ) {
          vscode.window.showErrorMessage("Open the comment editor before updating.");
          return;
        }

        await editComment(selected.comment);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.addComment", async () => {
      const selected = ticketsView.selection[0] as TicketTreeItem | undefined;
      if (!selected) {
        vscode.window.showErrorMessage("Select a ticket before adding a comment.");
        return;
      }

      await addCommentForIssue({
        issueId: selected.ticket.id,
        onSuccess: () => commentsProvider.refreshForTicket(selected.ticket.id),
      });
    }),
  );

  context.subscriptions.push(
    projectsView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0] as ProjectTreeItem | undefined;
      if (!selected) {
        return;
      }

      await setProjectSelection(selected.project.id, selected.project.name);
      projectsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    ticketsView.onDidChangeSelection((event) => {
      handleTicketSelection(event.selection[0] as TicketTreeItem | undefined);
    }),
  );

  context.subscriptions.push(
    activityTicketsView.onDidChangeSelection((event) => {
      handleTicketSelection(event.selection[0] as TicketTreeItem | undefined);
    }),
  );

  context.subscriptions.push(
    commentsView.onDidChangeSelection((event) => {
      void handleCommentSelection(event.selection[0] as CommentTreeItem | undefined);
    }),
  );

  context.subscriptions.push(
    activityCommentsView.onDidChangeSelection((event) => {
      void handleCommentSelection(event.selection[0] as CommentTreeItem | undefined);
    }),
  );

  const initialSelection = getProjectSelection();
  await projectsProvider.loadProjects();
  if (initialSelection.id) {
    const projectItem = projectsProvider.getProjectItemById(initialSelection.id);
    if (projectItem) {
      await projectsView.reveal(projectItem, { select: true, focus: false });
    }
    ticketsProvider.setSelectedProjectId(initialSelection.id);
  }

  ticketsProvider.refresh();
}

export function deactivate() {}
