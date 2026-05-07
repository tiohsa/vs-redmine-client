import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
import * as fs from "fs";
import { getProjectTrackers } from "../../redmine/projects";
import { buildNewTicketDraftContent } from "../../views/ticketDraftStore";
import { openNewTicketDraft } from "../../commands/createTicketFromList";
import { syncNewTicketDraft } from "../../views/ticketSaveSync";
import type { TicketSaveResult } from "../../views/ticketSaveTypes";
import { getTicketIdForEditor } from "../../views/ticketEditorRegistry";
import { removeOfflineNewTicket } from "../../views/offlineSyncStore";
import { type DashboardWorkPanel, type NewTicketComposerValues } from "../dashboardProtocol";
import type { Ticket } from "../../redmine/types";

export class DashboardComposerService {
  constructor(private readonly deps: {
    context: DashboardServiceContext;
    getResolvedProject: () => { id: number; name: string } | undefined;
    getTickets: () => Ticket[];
    refreshUnsynced: () => void;
    loadTickets: () => Promise<void>;
    selectTicket: (ticketId: number) => Promise<void>;
  }) {}

  async openNewTicketComposer(): Promise<void> {
    const project = this.deps.getResolvedProject();
    if (!project) {
      this.deps.context.notifyToast("warning", vscode.l10n.t("Select a project before creating a ticket."));
      return;
    }
    const defaults = this.deps.context.store.getState().metadataOptions;
    this.deps.context.store.update({
      workPanel: {
        mode: "newTicket",
        loading: true,
        projectId: project.id,
        projectName: project.name,
        trackers: [],
        priorities: defaults.priorities,
        statuses: defaults.statuses,
        values: this.buildComposerValues({}),
      },
    });
    await this.loadComposerTrackers(project.id);
  }

  async openChildTicketComposer(parentTicketId: number): Promise<void> {
    const parent = this.deps.getTickets().find((t) => t.id === parentTicketId);
    if (!parent) {
      this.deps.context.notifyError("ticket.createChild", vscode.l10n.t("Parent ticket not found."));
      return;
    }
    if (!parent.projectId) {
      this.deps.context.notifyError("ticket.createChild", vscode.l10n.t("Parent ticket is missing project information."));
      return;
    }
    const projectName = parent.projectName ?? String(parent.projectId);
    const defaults = this.deps.context.store.getState().metadataOptions;
    this.deps.context.store.update({
      workPanel: {
        mode: "childTicket",
        loading: true,
        projectId: parent.projectId,
        projectName,
        parentTicketId,
        parentSubject: parent.subject ?? "",
        trackers: [],
        priorities: defaults.priorities,
        statuses: defaults.statuses,
        values: this.buildComposerValues({}),
      },
    });
    await this.loadComposerTrackers(parent.projectId, parent);
  }

  cancelComposer(): void {
    const selectedTicketId = this.deps.context.store.getState().selectedTicketId;
    if (selectedTicketId) {
      this.deps.context.store.update({ workPanel: { mode: "detail", ticketId: selectedTicketId } });
      return;
    }
    this.deps.context.store.update({ workPanel: undefined });
  }

  async createDraftFromComposer(
    requestId: string,
    values: {
      tracker: string;
      priority: string;
      status: string;
      start_date?: string;
      due_date?: string;
      description?: string;
    },
  ): Promise<void> {
    const workPanel = this.deps.context.store.getState().workPanel;
    if (!workPanel || (workPanel.mode !== "newTicket" && workPanel.mode !== "childTicket")) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Ticket creation panel is not open."));
      return;
    }
    const validationError = this.validateComposerValues(workPanel, values);
    if (validationError) {
      this.updateWorkPanelComposer({ error: validationError });
      return;
    }
    try {
      const uri = await openNewTicketDraft({
        content: buildNewTicketDraftContent({
          projectId: workPanel.projectId,
          initialContent: {
            subject: "",
            description: values.description ?? "",
            metadata: {
              tracker: values.tracker,
              priority: values.priority,
              status: values.status,
              start_date: values.start_date ?? "",
              due_date: values.due_date ?? "",
              parent: workPanel.mode === "childTicket" ? workPanel.parentTicketId : undefined,
              children: [],
            },
          },
        }),
        projectId: workPanel.projectId,
      });
      this.updateWorkPanelComposer({ draftUri: uri.toString() });
    } catch (err) {
      const msg = (err as Error).message;
      this.deps.context.notifyError(requestId, vscode.l10n.t("Failed to create draft: {0}", msg));
    }
  }

  async handleSyncNewTicketDraftFromComposer(
    requestId: string,
    hooks?: {
      syncFn?: (editor: vscode.TextEditor) => Promise<TicketSaveResult>;
      getTicketIdFn?: (editor: vscode.TextEditor) => number | undefined;
      findEditorFn?: (draftUri: string) => vscode.TextEditor | undefined;
      openEditorFn?: (uri: vscode.Uri) => Promise<vscode.TextEditor>;
      findDocumentFn?: (draftUri: string) => vscode.TextDocument | undefined;
      fileExistsFn?: (path: string) => boolean;
      afterCreatedFn?: (createdId: number) => Promise<void>;
    },
  ): Promise<void> {
    const workPanel = this.deps.context.store.getState().workPanel;
    if (!workPanel || (workPanel.mode !== "newTicket" && workPanel.mode !== "childTicket")) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Composer is not open."));
      return;
    }

    const draftUri = workPanel.draftUri;
    if (!draftUri) {
      this.deps.context.notifyError(requestId, vscode.l10n.t("Draft file has not been created yet. Create a draft first."));
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, vscode.l10n.t("Syncing…"));

    const openEditorFn = hooks?.openEditorFn ??
      (async (uri: vscode.Uri): Promise<vscode.TextEditor> => {
        const doc = await vscode.workspace.openTextDocument(uri);
        return vscode.window.showTextDocument(doc, { preview: false });
      });
    const syncFn = hooks?.syncFn ?? ((editor: vscode.TextEditor) => syncNewTicketDraft({ editor }));
    const getTicketIdFn = hooks?.getTicketIdFn ?? getTicketIdForEditor;

    const editor = await this.openDraftEditorSafely(draftUri, {
      findEditorFn: hooks?.findEditorFn,
      findDocumentFn: hooks?.findDocumentFn,
      openEditorFn,
      fileExistsFn: hooks?.fileExistsFn,
    });
    const resolvedUri = editor.document.uri.toString();
    if (resolvedUri !== draftUri) {
      this.updateWorkPanelComposer({ draftUri: resolvedUri });
    }

    const result = await syncFn(editor);

    if (result.status === "created") {
      const createdId = getTicketIdFn(editor);
      this.removeOfflineNewTicketByUriVariants(draftUri);
      this.removeOfflineNewTicketByUriVariants(resolvedUri);
      this.deps.refreshUnsynced();
      if (hooks?.afterCreatedFn) {
        await hooks.afterCreatedFn(createdId ?? 0);
        this.deps.context.onTicketsRefreshed();
        this.deps.context.notifySuccess(requestId, vscode.l10n.t("Ticket created."));
      } else {
        await this.deps.loadTickets();
        this.deps.context.onTicketsRefreshed();
        if (createdId !== undefined && createdId > 0) {
          this.deps.context.store.update({ workPanel: { mode: "detail", ticketId: createdId } });
          await this.deps.selectTicket(createdId);
          this.deps.context.notifySuccess(requestId, vscode.l10n.t("Ticket created."));
        } else {
          this.deps.context.notifySuccess(
            requestId,
            vscode.l10n.t("Ticket created. However, the new ticket ID could not be determined. Refresh the list to check."),
          );
        }
      }
      return;
    }

    if (result.status === "failed") {
      const raw = result.message ?? vscode.l10n.t("Unknown error");
      const displayMsg = raw === "Ticket subject is required."
        ? vscode.l10n.t("Subject is missing. Enter a subject in the Markdown heading line and sync again.")
        : vscode.l10n.t("Sync failed: {0}", raw);
      this.deps.context.notifyError(requestId, displayMsg);
      return;
    }

    if (result.status === "queued") {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("Added to offline sync queue."));
      return;
    }

    if (result.status === "no_change") {
      this.deps.context.notifySuccess(requestId, vscode.l10n.t("No changes."));
      return;
    }

    this.deps.context.notifyError(requestId, vscode.l10n.t("Sync failed: {0}", result.message ?? vscode.l10n.t("Unknown error")));
  }

  private findDraftEditorByUri(
    draftUri: string,
    editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors,
  ): vscode.TextEditor | undefined {
    const parsed = vscode.Uri.parse(draftUri);
    return editors.find((editor) =>
      editor.document.uri.toString() === draftUri || editor.document.uri.fsPath === parsed.fsPath
    );
  }

  private findTextDocumentByUri(
    draftUri: string,
    docs: readonly vscode.TextDocument[] = vscode.workspace.textDocuments,
  ): vscode.TextDocument | undefined {
    const parsed = vscode.Uri.parse(draftUri);
    return docs.find((doc) => doc.uri.toString() === draftUri || doc.uri.fsPath === parsed.fsPath);
  }

  private async openDraftEditorSafely(
    draftUri: string,
    deps: {
      findEditorFn?: (draftUri: string) => vscode.TextEditor | undefined;
      findDocumentFn?: (draftUri: string) => vscode.TextDocument | undefined;
      openEditorFn: (uri: vscode.Uri) => Promise<vscode.TextEditor>;
      fileExistsFn?: (path: string) => boolean;
    },
  ): Promise<vscode.TextEditor> {
    const foundEditor = deps.findEditorFn?.(draftUri) ?? this.findDraftEditorByUri(draftUri);
    if (foundEditor) {
      return foundEditor;
    }

    const foundDoc = deps.findDocumentFn?.(draftUri) ?? this.findTextDocumentByUri(draftUri);
    if (foundDoc) {
      return deps.openEditorFn(foundDoc.uri);
    }

    const parsed = vscode.Uri.parse(draftUri);
    if (parsed.scheme === "untitled") {
      const fileExistsFn = deps.fileExistsFn ?? fs.existsSync;
      if (fileExistsFn(parsed.fsPath)) {
        return deps.openEditorFn(vscode.Uri.file(parsed.fsPath));
      }
    }
    return deps.openEditorFn(parsed);
  }

  private removeOfflineNewTicketByUriVariants(uriText: string): void {
    const variants = new Set<string>([uriText]);
    const parsed = vscode.Uri.parse(uriText);
    variants.add(parsed.toString());
    if (parsed.fsPath) {
      variants.add(vscode.Uri.file(parsed.fsPath).toString());
    }
    if (parsed.scheme === "file" && parsed.path) {
      variants.add(`file:${parsed.path}`);
    }
    variants.forEach((uri) => removeOfflineNewTicket({ documentUri: uri }));
  }

  private buildComposerValues(input: {
    tracker?: string;
    priority?: string;
    status?: string;
    start_date?: string;
    due_date?: string;
    subject?: string;
    description?: string;
  }): NewTicketComposerValues {
    return {
      subject: input.subject ?? "",
      tracker: input.tracker,
      priority: input.priority,
      status: input.status,
      start_date: input.start_date ?? "",
      due_date: input.due_date ?? "",
      description: input.description ?? "",
    };
  }

  private async loadComposerTrackers(
    projectId: number,
    parentTicket?: Ticket,
  ): Promise<void> {
    try {
      const trackers = await getProjectTrackers(projectId);
      if (trackers.length === 0) {
        this.updateWorkPanelComposer({ loading: false, trackers: [], error: vscode.l10n.t("No trackers configured for this project.") });
        return;
      }
      const defaults = this.deps.context.store.getState().metadataOptions;
      const firstTracker = trackers[0]?.name;
      const defaultTracker = this.suggestDefaultTracker(trackers, parentTicket?.trackerName) ?? firstTracker;
      const defaultPriority = this.pickOptionName(defaults.priorities, parentTicket?.priorityName) ?? defaults.priorities[0]?.name;
      const defaultStatus = this.pickOptionName(defaults.statuses, "New") ?? defaults.statuses[0]?.name;
      this.updateWorkPanelComposer({
        loading: false,
        trackers,
        error: undefined,
        values: this.buildComposerValues({
          tracker: defaultTracker,
          priority: defaultPriority,
          status: defaultStatus,
          due_date: parentTicket?.dueDate,
        }),
      });
    } catch (err) {
      const msg = (err as Error).message;
      this.updateWorkPanelComposer({ loading: false, trackers: [], error: vscode.l10n.t("Failed to load trackers: {0}", msg) });
    }
  }

  private pickOptionName(
    options: Array<{ name: string }>,
    candidate?: string,
  ): string | undefined {
    if (!candidate) {
      return undefined;
    }
    return options.some((option) => option.name === candidate) ? candidate : undefined;
  }

  private suggestDefaultTracker(
    trackers: Array<{ id: number; name: string }>,
    preferred?: string,
  ): string | undefined {
    if (preferred && trackers.some((tracker) => tracker.name === preferred)) {
      return preferred;
    }
    const defaultTracker = this.deps.context.store.getState().metadataOptions.trackers
      .find((tracker) => trackers.some((projectTracker) => projectTracker.id === tracker.id));
    return defaultTracker?.name;
  }

  private updateWorkPanelComposer(
    patch: {
      loading?: boolean;
      trackers?: Array<{ id: number; name: string }>;
      priorities?: Array<{ id: number; name: string }>;
      statuses?: Array<{ id: number; name: string }>;
      values?: NewTicketComposerValues;
      draftUri?: string;
      error?: string;
    },
  ): void {
    const current = this.deps.context.store.getState().workPanel;
    if (!current || (current.mode !== "newTicket" && current.mode !== "childTicket")) {
      return;
    }
    if (current.mode === "newTicket") {
      this.deps.context.store.update({ workPanel: { ...current, ...patch, mode: "newTicket" } });
      return;
    }
    this.deps.context.store.update({ workPanel: { ...current, ...patch, mode: "childTicket" } });
  }

  private validateComposerValues(
    panel: Extract<DashboardWorkPanel, { mode: "newTicket" | "childTicket" }>,
    values: {
      tracker: string;
      priority: string;
      status: string;
      start_date?: string;
      due_date?: string;
      description?: string;
    },
  ): string | undefined {
    if (!panel.projectId) {
      return vscode.l10n.t("No project selected.");
    }
    if (!values.tracker.trim()) {
      return vscode.l10n.t("Please select a tracker.");
    }
    if (!panel.trackers.some((tracker) => tracker.name === values.tracker)) {
      return vscode.l10n.t("Tracker not available for this project: {0}", values.tracker);
    }
    if (!values.priority.trim()) {
      return vscode.l10n.t("Please select a priority.");
    }
    const isValidDate = (value?: string): boolean =>
      value === undefined || value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isValidDate(values.start_date)) {
      return vscode.l10n.t("Invalid start date format (YYYY-MM-DD).");
    }
    if (!isValidDate(values.due_date)) {
      return vscode.l10n.t("Invalid due date format (YYYY-MM-DD).");
    }
    if (panel.mode === "childTicket" && !panel.parentTicketId) {
      return vscode.l10n.t("Parent ticket information is missing.");
    }
    return undefined;
  }
}
