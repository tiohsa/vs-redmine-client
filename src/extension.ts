import * as path from "path";
import * as vscode from "vscode";
import { addCommentFromList } from "./commands/addCommentFromList";
import { createTicketFromEditor } from "./commands/createTicket";
import { createChildTicketFromList } from "./commands/createChildTicketFromList";
import { createTicketFromList } from "./commands/createTicketFromList";
import { editComment } from "./commands/editComment";
import {
  openCommentInBrowser,
  openProjectInBrowser,
  openTicketInBrowser,
} from "./commands/openInBrowser";
import { reloadCommentFromEditor } from "./commands/reloadComment";
import { reloadTicketFromEditor } from "./commands/reloadTicket";
import { setProjectSelection, getProjectSelection } from "./config/projectSelection";
import { getIssueDetail } from "./redmine/issues";
import { showError, showSuccess, showWarning } from "./utils/notifications";
import { setCommentDraft } from "./views/commentDraftStore";
import { CommentTreeItem, CommentsTreeProvider } from "./views/commentsView";
import { setCommentDraftBody } from "./views/commentEditStore";
import {
  isNewTicketDraftFilename,
  parseEditorFilename,
  parseNewCommentDraftFilename,
} from "./views/editorFilename";
import { ProjectTreeItem, ProjectsTreeProvider } from "./views/projectsView";
import { parseTicketEditorContent } from "./views/ticketEditorContent";
import { setTicketDraftContent } from "./views/ticketDraftStore";
import {
  configureEditorDefaultField,
  EDITOR_DEFAULT_COMMANDS,
  resetEditorDefaults,
  TicketSettingsTreeProvider,
} from "./views/ticketSettingsView";
import {
  TicketTreeItem,
  TicketsTreeProvider,
  TICKET_SETTINGS_COMMANDS,
} from "./views/ticketsView";
import {
  getCommentIdForEditor,
  getCommentIdForDocument,
  getCommentIdForUri,
  getEditorContentType,
  getProjectIdForDocument,
  getProjectIdForUri,
  getTicketIdForEditor,
  getTicketIdForDocument,
  getTicketIdForUri,
  isTicketEditor,
  markEditorActive,
  NEW_TICKET_DRAFT_ID,
  registerTicketDocument,
  removeTicketEditorByDocument,
} from "./views/ticketEditorRegistry";
import { showTicketComment, showTicketPreview } from "./views/ticketPreview";
import { getCommentSaveNotification } from "./views/commentSaveNotifications";
import {
  handleCommentEditorSave,
  finalizeNewCommentDraftDocument,
  shouldRefreshComments,
  syncCommentDraft,
  syncNewCommentDraft,
} from "./views/commentSaveSync";
import { getSaveNotification } from "./views/ticketSaveNotifications";
import {
  handleTicketEditorSave,
  syncNewTicketDraft,
  syncNewTicketDraftContent,
  syncTicketDraft,
} from "./views/ticketSaveSync";
import { registerFocusRefresh } from "./views/viewFocusRefresh";
import { initializeTreeExpansionState, setTreeExpanded } from "./views/treeState";
import {
  VIEW_ID_ACTIVITY_COMMENTS,
  VIEW_ID_ACTIVITY_PROJECTS,
  VIEW_ID_ACTIVITY_TICKET_SETTINGS,
  VIEW_ID_ACTIVITY_TICKETS,
} from "./views/viewIds";

export async function activate(context: vscode.ExtensionContext) {
  initializeTreeExpansionState(context.workspaceState);
  const ticketsProvider = new TicketsTreeProvider();
  const settingsProvider = new TicketSettingsTreeProvider(ticketsProvider);
  const commentsProvider = new CommentsTreeProvider();
  const projectsProvider = new ProjectsTreeProvider();
  let lastProjectSelection: ProjectTreeItem | undefined;
  let lastTicketSelection: TicketTreeItem | undefined;
  const activityProjectsView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_PROJECTS,
    {
      treeDataProvider: projectsProvider,
    },
  );
  const activitySettingsView = vscode.window.createTreeView(
    VIEW_ID_ACTIVITY_TICKET_SETTINGS,
    {
      treeDataProvider: settingsProvider,
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
  const trackExpansionState = <T extends vscode.TreeItem>(
    view: vscode.TreeView<T>,
    viewKey: string,
  ): void => {
    context.subscriptions.push(
      view.onDidExpandElement((event) => {
        const elementId = event.element.id;
        if (elementId) {
          setTreeExpanded(viewKey, String(elementId), true);
        }
      }),
      view.onDidCollapseElement((event) => {
        const elementId = event.element.id;
        if (elementId) {
          setTreeExpanded(viewKey, String(elementId), false);
        }
      }),
    );
  };
  const runTreeCollapseCommand = async (viewId: string): Promise<boolean> => {
    await vscode.commands.executeCommand(`${viewId}.focus`);
    const commandId = "list.collapseAll";
    const available = await vscode.commands.getCommands(true);
    if (!available.includes(commandId)) {
      return false;
    }
    await vscode.commands.executeCommand(commandId);
    return true;
  };
  const restoreTreeScroll = async (
    view: vscode.TreeView<vscode.TreeItem>,
    item?: vscode.TreeItem,
  ): Promise<void> => {
    if (!item) {
      return;
    }
    await view.reveal(item, { focus: false, select: false });
  };
  let selectedComment: CommentTreeItem | undefined;
  let selectedCommentDocumentUri: string | undefined;
  context.subscriptions.push(
    activityProjectsView,
    activitySettingsView,
    activityTicketsView,
    activityCommentsView,
    registerFocusRefresh(activityProjectsView, () => projectsProvider.refresh()),
    registerFocusRefresh(activitySettingsView, () => settingsProvider.refresh()),
    registerFocusRefresh(activityTicketsView, () => ticketsProvider.refresh()),
    registerFocusRefresh(activityCommentsView, () => commentsProvider.refresh()),
  );
  trackExpansionState(activityProjectsView, "projects");
  trackExpansionState(activityTicketsView, "tickets");

  const getSelectedComment = (item?: CommentTreeItem): CommentTreeItem | undefined => {
    return (
      item ??
      (activityCommentsView.selection[0] as CommentTreeItem | undefined) ??
      selectedComment
    );
  };

  const handleTicketSelection = (item?: TicketTreeItem): void => {
    const selected =
      item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
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
        if (ticketId && contentType === "ticket") {
          try {
            const parsed = parseTicketEditorContent(
              previousActiveEditor.document.getText(),
            );
            setTicketDraftContent(ticketId, parsed);
          } catch {
            // Ignore parse errors when swapping focus; save will surface validation errors.
          }
        } else if (ticketId && contentType === "comment") {
          const draft = previousActiveEditor.document.getText();
          setCommentDraft(ticketId, draft);
          const commentId = getCommentIdForEditor(previousActiveEditor);
          if (commentId) {
            setCommentDraftBody(commentId, draft);
          }
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

  const notifyTicketSaveResult = (result: Awaited<ReturnType<typeof handleTicketEditorSave>>): void => {
    if (!result) {
      return;
    }

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
  };

  const notifyCommentSaveResult = (
    result: Awaited<ReturnType<typeof handleCommentEditorSave>>,
  ): void => {
    if (!result) {
      return;
    }

    const notification = getCommentSaveNotification(result);
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
  };

  const updateTicketListSubject = (ticketId: number, subject: string): void => {
    ticketsProvider.updateTicketSubject(ticketId, subject);
  };

  const syncOnSave = (document: vscode.TextDocument): void => {
    const editor =
      vscode.window.visibleTextEditors.find((candidate) => candidate.document === document) ??
      (vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor
        : undefined);

    void (async () => {
      if (editor) {
        const ticketResult = await handleTicketEditorSave(editor, {
          onSubjectUpdated: updateTicketListSubject,
        });
        if (ticketResult) {
          notifyTicketSaveResult(ticketResult);
          if (ticketResult.status === "created") {
            ticketsProvider.refresh();
          }
          return;
        }

        const commentResult = await handleCommentEditorSave(editor);
        if (commentResult) {
          notifyCommentSaveResult(commentResult);
          if (shouldRefreshComments(commentResult.status)) {
            const ticketId = getTicketIdForEditor(editor);
            if (ticketId) {
              commentsProvider.refreshForTicket(ticketId);
            }
          }
          return;
        }
      }

      const commentIdForDocument =
        getCommentIdForDocument(document) ?? getCommentIdForUri(document.uri);
      if (commentIdForDocument) {
        const ticketIdForDocument =
          getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
        if (!ticketIdForDocument) {
          return;
        }
        const commentResult = await syncCommentDraft({
          commentId: commentIdForDocument,
          content: document.getText(),
        });
        notifyCommentSaveResult(commentResult);
        if (shouldRefreshComments(commentResult.status)) {
          commentsProvider.refreshForTicket(ticketIdForDocument);
        }
        return;
      }

      const ticketIdForDocument =
        getTicketIdForDocument(document) ?? getTicketIdForUri(document.uri);
      if (ticketIdForDocument) {
        if (ticketIdForDocument === NEW_TICKET_DRAFT_ID) {
          const projectId =
            getProjectIdForDocument(document) ?? getProjectIdForUri(document.uri);
          const result = await syncNewTicketDraftContent({
            content: document.getText(),
            projectId,
            onCreated: (createdId) => {
              removeTicketEditorByDocument(document);
              registerTicketDocument(createdId, document, "ticket", projectId);
            },
          });
          notifyTicketSaveResult(result);
          if (result.status === "created") {
            ticketsProvider.refresh();
          }
          return;
        }

        const result = await syncTicketDraft({
          ticketId: ticketIdForDocument,
          content: document.getText(),
          onSubjectUpdated: updateTicketListSubject,
        });
        notifyTicketSaveResult(result);
        return;
      }

      const filename = path.basename(document.uri.path);
      const parsed = parseEditorFilename(filename);
      if (!parsed) {
        const draftTicketId = parseNewCommentDraftFilename(filename);
        if (!draftTicketId) {
          if (!isNewTicketDraftFilename(filename)) {
            return;
          }

          if (editor) {
            const result = await syncNewTicketDraft({ editor });
            notifyTicketSaveResult(result);
            if (result.status === "created") {
              ticketsProvider.refresh();
            }
            return;
          }

          const result = await syncNewTicketDraftContent({
            content: document.getText(),
            onCreated: (createdId) => {
              removeTicketEditorByDocument(document);
              registerTicketDocument(createdId, document, "ticket");
            },
          });
          notifyTicketSaveResult(result);
          if (result.status === "created") {
            ticketsProvider.refresh();
          }
          return;
        }

        const result = await syncNewCommentDraft({
          ticketId: draftTicketId,
          content: document.getText(),
          onCreated: async ({ commentId, projectId }) => {
            finalizeNewCommentDraftDocument({
              document,
              ticketId: draftTicketId,
              projectId,
              commentId,
            });
          },
        });
        notifyCommentSaveResult(result);
        if (shouldRefreshComments(result.status)) {
          commentsProvider.refreshForTicket(draftTicketId);
        }
        return;
      }

      if (parsed.type === "ticket") {
        const result = await syncTicketDraft({
          ticketId: parsed.ticketId,
          content: document.getText(),
          onSubjectUpdated: updateTicketListSubject,
        });
        notifyTicketSaveResult(result);
        return;
      }

      const commentResult = await syncCommentDraft({
        commentId: parsed.commentId,
        content: document.getText(),
      });
      notifyCommentSaveResult(commentResult);
      if (shouldRefreshComments(commentResult.status)) {
        commentsProvider.refreshForTicket(parsed.ticketId);
      }
    })();
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      syncOnSave(document);
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
    vscode.commands.registerCommand("todoex.collapseAllProjects", async () => {
      projectsProvider.collapseAllVisible();
      const selected =
        activityProjectsView.selection[0] ??
        lastProjectSelection ??
        projectsProvider
          .getViewItems()
          .find((item): item is ProjectTreeItem => item instanceof ProjectTreeItem);
      const usedListCommand = await runTreeCollapseCommand(
        VIEW_ID_ACTIVITY_PROJECTS,
      );
      if (usedListCommand) {
        await restoreTreeScroll(activityProjectsView, selected);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.collapseAllTickets", async () => {
      ticketsProvider.collapseAllVisible();
      const usedListCommand = await runTreeCollapseCommand(
        VIEW_ID_ACTIVITY_TICKETS,
      );
      if (usedListCommand) {
        const selected =
          activityTicketsView.selection[0] ??
          lastTicketSelection ??
          ticketsProvider
            .getViewItems()
            .find((item): item is TicketTreeItem => item instanceof TicketTreeItem);
        await restoreTreeScroll(activityTicketsView, selected);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.reloadTicket", async () => {
      await reloadTicketFromEditor();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.reloadComment", async () => {
      await reloadCommentFromEditor();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.priorityFilter, async () => {
      await ticketsProvider.configurePriorityFilter();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.statusFilter, async () => {
      await ticketsProvider.configureStatusFilter();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.trackerFilter, async () => {
      await ticketsProvider.configureTrackerFilter();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.assigneeFilter, async () => {
      await ticketsProvider.configureAssigneeFilter();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.sort, async () => {
      await ticketsProvider.configureSort();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.dueDate, async () => {
      await ticketsProvider.configureDueDateDisplay();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TICKET_SETTINGS_COMMANDS.reset, () => {
      ticketsProvider.resetTicketSettings();
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.subject, async () => {
      await configureEditorDefaultField("subject");
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.description, async () => {
      await configureEditorDefaultField("description");
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.tracker, async () => {
      await configureEditorDefaultField("tracker");
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.priority, async () => {
      await configureEditorDefaultField("priority");
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.status, async () => {
      await configureEditorDefaultField("status");
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.dueDate, async () => {
      await configureEditorDefaultField("due_date");
      settingsProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(EDITOR_DEFAULT_COMMANDS.reset, async () => {
      await resetEditorDefaults();
      settingsProvider.refresh();
    }),
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
        const selected =
          item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
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
        const selected =
          item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
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
    vscode.commands.registerCommand("todoex.createTicketFromList", async () => {
      await createTicketFromList();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.createChildTicketFromList", async (item) => {
      await createChildTicketFromList(item as TicketTreeItem | undefined);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.openProjectInBrowser",
      async (item?: ProjectTreeItem) => {
        const selected =
          item ?? (activityProjectsView.selection[0] as ProjectTreeItem | undefined);
        await openProjectInBrowser(selected);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.openTicketInBrowser",
      async (item?: TicketTreeItem) => {
        const selected =
          item ?? (activityTicketsView.selection[0] as TicketTreeItem | undefined);
        await openTicketInBrowser(selected);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "todoex.openCommentInBrowser",
      async (item?: CommentTreeItem) => {
        const selected =
          item ?? (activityCommentsView.selection[0] as CommentTreeItem | undefined);
        await openCommentInBrowser(selected);
      },
    ),
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
      const selected =
        activityTicketsView.selection[0] as TicketTreeItem | undefined;
      if (!selected) {
        vscode.window.showErrorMessage("Select a ticket before adding a comment.");
        return;
      }

      await addCommentFromList(selected.ticket.id);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoex.addCommentFromComments", async () => {
      const ticketId = commentsProvider.getTicketId();
      await addCommentFromList(ticketId);
    }),
  );

  context.subscriptions.push(
    activityTicketsView.onDidChangeSelection((event) => {
      const selected = event.selection[0] as TicketTreeItem | undefined;
      handleTicketSelection(selected);
      if (selected) {
        lastTicketSelection = selected;
      }
    }),
  );

  context.subscriptions.push(
    activityProjectsView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0] as ProjectTreeItem | undefined;
      if (!selected) {
        return;
      }

      lastProjectSelection = selected;
      await setProjectSelection(selected.project.id, selected.project.name);
      projectsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.setSelectedProjectId(selected.project.id);
      ticketsProvider.refresh();
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
      await activityProjectsView.reveal(projectItem, { select: true, focus: false });
    }
    ticketsProvider.setSelectedProjectId(initialSelection.id);
  }

  ticketsProvider.refresh();
}

export function deactivate() {}
