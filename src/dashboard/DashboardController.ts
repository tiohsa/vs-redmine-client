import * as vscode from "vscode";
import { getProjectSelection, setProjectSelection } from "../config/projectSelection";
import { getDefaultProjectId, getIncludeChildProjects, getTicketListLimit } from "../config/settings";
import { listProjects, getProjectTrackers } from "../redmine/projects";
import { getIssueDetail, listIssuePriorities, listIssueStatuses, listIssues, listTrackers } from "../redmine/issues";
import { applyTicketFilters, applyTicketSort } from "../views/projectListSettings";
import {
  onOfflineSyncQueueChanged,
  addOfflineTicketUpdate,
  getOfflineSyncQueue,
  removeOfflineCommentEntry,
  removeOfflineNewTicket,
  removeOfflineTicketUpdate,
} from "../views/offlineSyncStore";
import { runOfflineSync } from "../commands/offlineSync";
import type { OfflineSyncRunResult } from "../commands/offlineSync";
import { syncUnsyncedFile } from "../commands/syncUnsyncedFile";
import type { SyncUnsyncedFileResult } from "../commands/syncUnsyncedFile";
import { openTicketInBrowser, openCommentInBrowser } from "../commands/openInBrowser";
import { addCommentFromList } from "../commands/addCommentFromList";
import { openCommentUpdateDraft } from "../commands/openCommentUpdateDraft";
import { rememberTicketSummaries } from "../views/ticketSummaryStore";
import { showTicketPreview } from "../views/ticketPreview";
import {
  buildNewTicketDraftContent,
  ensureTicketDraft,
  markDraftStatus,
  setTicketDraftContent,
} from "../views/ticketDraftStore";
import { openNewTicketDraft } from "../commands/createTicketFromList";
import { Ticket } from "../redmine/types";
import type { UnsyncedFileSyncKey } from "../views/unsyncedFilesView";
import { buildTicketDashboardNodes, buildTicketDetail } from "./viewModels/ticketDashboardViewModel";
import { buildUnsyncedDashboardItems } from "./viewModels/unsyncedDashboardViewModel";
import { buildCommentDashboardItems } from "./viewModels/commentsDashboardViewModel";
import { DashboardStateStore } from "./DashboardStateStore";
import { SettingsController } from "./SettingsController";
import type {
  DashboardProjectNode,
  DashboardRequest,
  DashboardMetadataOptions,
  DashboardUnsyncedKey,
  TicketMetadataPatch,
  DashboardWorkPanel,
  NewTicketComposerValues,
} from "./dashboardProtocol";
import { resolveCurrentProject, type ResolvedProject } from "./resolveProject";
import {
  buildTicketEditorContent,
  parseTicketEditorContent,
  type TicketEditorContent,
} from "../views/ticketEditorContent";
import { getTicketEditors, registerTicketDocument } from "../views/ticketEditorRegistry";
import { applyEditorContent } from "../views/ticketPreview";
import type { SyncStatus } from "../app/syncController";

export interface DashboardControllerOptions {
  store: DashboardStateStore;
  notifyOperationStarted: (requestId: string, label?: string) => void;
  notifySuccess: (requestId: string, msg: string) => void;
  notifyError: (requestId: string, msg: string) => void;
  notifyToast: (level: "info" | "warning" | "error" | "success", msg: string) => void;
  onTicketsRefreshed: () => void;
}

export class DashboardController {
  private tickets: Ticket[] = [];
  private projects: DashboardProjectNode[] = [];
  private metadataOptionsLoaded = false;
  private totalCount = 0;
  private lastCreatedTicketIdFromComposer?: number;
  private readonly settingsCtrl: SettingsController;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly opts: DashboardControllerOptions) {
    this.settingsCtrl = new SettingsController(opts.store);
    this.disposables.push(
      { dispose: onOfflineSyncQueueChanged(() => this.refreshUnsynced()) },
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.settingsCtrl.pushSettings();
    await Promise.all([this.loadProjects(), this.loadMetadataOptions(), this.loadTickets()]);
  }

  async handle(req: DashboardRequest): Promise<void> {
    try {
      await this.handleRequest(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.notifyError(req.requestId, `操作に失敗しました: ${msg}`);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  // ── Private request handler ────────────────────────────────────────────

  private async handleRequest(req: DashboardRequest): Promise<void> {
    switch (req.type) {
      case "dashboard.ready":
      case "dashboard.refresh":
        await Promise.all([this.loadProjects(), this.loadMetadataOptions(), this.loadTickets()]);
        break;
      case "project.select":
        await this.selectProject(req.projectId);
        break;
      case "project.toggleChildren":
        await this.toggleIncludeChildren(req.includeChildProjects);
        break;
      case "tickets.refresh":
        await this.loadTickets();
        break;
      case "tickets.loadMore":
        await this.loadMoreTickets();
        break;
      case "ticket.select":
        await this.selectTicket(req.ticketId);
        break;
      case "ticket.openEditor":
        void this.selectTicket(req.ticketId);
        await this.openEditor(req.ticketId);
        break;
      case "ticket.openBrowser":
        void this.selectTicket(req.ticketId);
        await this.openInBrowser(req.ticketId);
        break;
      case "ticket.create":
        await this.openNewTicketComposer();
        break;
      case "ticket.createChild":
        void this.selectTicket(req.parentTicketId);
        await this.openChildTicketComposer(req.parentTicketId);
        break;
      case "ticket.cancelComposer":
        this.cancelComposer();
        break;
      case "ticket.syncNewTicketDraftFromComposer":
        await this.handleSyncNewTicketDraftFromComposer(req.requestId);
        break;
      case "ticket.createDraftFromComposer":
        await this.createDraftFromComposer(req.requestId, req.values);
        break;
      case "ticket.metadata.update":
        await this.updateTicketMetadata(req.requestId, req.ticketId, req.patch);
        break;
      case "ticket.syncSelected":
        await this.handleSyncSelectedTicket(req.requestId, req.ticketId);
        break;
      case "comment.add":
        void this.selectTicket(req.ticketId);
        await addCommentFromList(req.ticketId);
        break;
      case "comment.edit":
        void this.selectTicket(req.ticketId);
        await this.editTicketComment(req.ticketId, req.commentId);
        break;
      case "comment.openBrowser":
        await this.openCommentInBrowser(req.ticketId, req.commentId, req.noteIndex);
        break;
      case "comment.reload":
        await this.loadComments(req.ticketId);
        break;
      case "unsynced.openLocalFile": {
        const uri = vscode.Uri.parse(req.documentUri);
        if (uri.scheme !== "file" && uri.scheme !== "vscode-userdata") {
          this.opts.notifyError(req.requestId, "この URI は開けません。");
          return;
        }
        await vscode.commands.executeCommand("vscode.open", uri);
        break;
      }
      case "unsynced.syncOne":
        await this.handleSyncOne(req.requestId, req.key);
        break;
      case "unsynced.discardOne":
        await this.handleDiscardOne(req.requestId, req.key);
        break;
      case "unsynced.syncAll":
        await this.handleSyncAll(req.requestId);
        break;
      case "settings.update":
        this.settingsCtrl.updateTicketList(req.patch);
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, "設定を更新しました。");
        break;
      case "settings.reset":
        this.settingsCtrl.resetTicketList();
        this.pushTickets();
        this.opts.notifySuccess(req.requestId, "設定をリセットしました。");
        break;
      case "settings.updateEditorDefault":
        this.settingsCtrl.updateEditorDefault(req.field, req.value);
        break;
      case "settings.resetEditorDefaults":
        this.settingsCtrl.resetEditorDefaults(req.fields);
        break;
      case "settings.updateGeneral":
        await this.settingsCtrl.updateGeneral(req.patch);
        await this.loadTickets();
        break;
    }
  }

  // ── Project resolution ─────────────────────────────────────────────────

  private getResolvedProject(): ResolvedProject | undefined {
    const selection = getProjectSelection();
    return resolveCurrentProject({
      selectionId: selection.id,
      selectionName: selection.name,
      defaultProjectId: getDefaultProjectId(),
      projects: this.projects,
    });
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async loadTickets(): Promise<void> {
    const { store } = this.opts;
    const project = this.getResolvedProject();

    store.update({
      selectedProject: project ? { id: project.id, name: project.name } : undefined,
      includeChildProjects: getIncludeChildProjects(),
      loading: { ...store.getState().loading, tickets: true },
      errors: { ...store.getState().errors, tickets: undefined },
    });

    if (!project) {
      this.tickets = [];
      this.totalCount = 0;
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
      return;
    }

    try {
      const result = await listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: 0,
      });
      this.tickets = result.tickets;
      this.totalCount = result.totalCount;
      rememberTicketSummaries(this.tickets);
      this.refreshUnsynced();
      this.pushTickets();
      store.updateNested("loading", { tickets: false });
    } catch (err) {
      const msg = (err as Error).message;
      store.update({
        loading: { ...store.getState().loading, tickets: false },
        errors: { ...store.getState().errors, tickets: `Failed to load tickets: ${msg}` },
      });
    }
  }

  private async loadMoreTickets(): Promise<void> {
    if (this.tickets.length >= this.totalCount) {
      return;
    }
    const { store } = this.opts;
    const project = this.getResolvedProject();
    if (!project) {
      return;
    }
    try {
      const result = await listIssues({
        projectId: project.id,
        includeChildProjects: getIncludeChildProjects(),
        limit: getTicketListLimit(),
        offset: this.tickets.length,
      });
      this.tickets = [...this.tickets, ...result.tickets];
      this.totalCount = result.totalCount;
      rememberTicketSummaries(result.tickets);
      this.pushTickets();
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("errors", { tickets: `Failed to load more: ${msg}` });
    }
  }

  private async loadProjects(): Promise<void> {
    try {
      const raw = await listProjects(true);
      this.projects = this.buildProjectNodes(raw);
      this.opts.store.update({ projects: this.projects });
    } catch {
      // プロジェクト読み込み失敗時は既存リストを維持する
    }
  }

  private async loadMetadataOptions(): Promise<void> {
    try {
      const [trackers, priorities, statuses] = await Promise.all([
        listTrackers(),
        listIssuePriorities(),
        listIssueStatuses(),
      ]);
      const options: DashboardMetadataOptions = {
        trackers,
        priorities,
        statuses,
      };
      this.metadataOptionsLoaded = true;
      this.opts.store.update({ metadataOptions: options });
    } catch {
      this.metadataOptionsLoaded = false;
      this.opts.store.update({ metadataOptions: { trackers: [], priorities: [], statuses: [] } });
    }
  }

  private buildProjectNodes(
    projects: Array<{ id: number; name: string; identifier: string; parentId?: number }>,
  ): DashboardProjectNode[] {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const computeLevel = (id: number, visited = new Set<number>()): number => {
      if (visited.has(id)) { return 0; }
      visited.add(id);
      const p = byId.get(id);
      if (!p?.parentId) { return 0; }
      return 1 + computeLevel(p.parentId, visited);
    };
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      identifier: p.identifier,
      parentId: p.parentId,
      level: computeLevel(p.id),
    }));
  }

  private async selectProject(projectId: number): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId);
    await setProjectSelection(projectId, project?.name ?? "");
    this.tickets = [];
    this.totalCount = 0;
    await this.loadTickets();
  }

  private async toggleIncludeChildren(include: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration("redmine-client")
      .update("includeChildProjects", include, vscode.ConfigurationTarget.Global);
    await this.loadTickets();
  }

  private async selectTicket(ticketId: number): Promise<void> {
    const { store } = this.opts;
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return;
    }
    store.update({
      selectedTicketId: ticketId,
      selectedTicket: buildTicketDetail(ticket, this.tickets),
      workPanel: { mode: "detail", ticketId },
    });
    await this.loadComments(ticketId);
  }

  private validateMetadataPatchAgainstOptions(patch: TicketMetadataPatch): string | undefined {
    if (!this.metadataOptionsLoaded) {
      return "メタデータ選択肢が未取得のため更新できません。";
    }
    const options = this.opts.store.getState().metadataOptions;
    if (patch.tracker !== undefined && !options.trackers.some((item) => item.name === patch.tracker)) {
      return `未知のトラッカーです: ${patch.tracker}`;
    }
    if (patch.priority !== undefined && !options.priorities.some((item) => item.name === patch.priority)) {
      return `未知の優先度です: ${patch.priority}`;
    }
    if (patch.status !== undefined && !options.statuses.some((item) => item.name === patch.status)) {
      return `未知のステータスです: ${patch.status}`;
    }
    return undefined;
  }

  private patchEditorContent(content: TicketEditorContent, patch: TicketMetadataPatch): TicketEditorContent {
    return {
      ...content,
      metadata: {
        ...content.metadata,
        ...(patch.tracker !== undefined ? { tracker: patch.tracker } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
        ...(patch.start_date !== undefined ? { start_date: patch.start_date } : {}),
      },
    };
  }

  private async updateTicketMetadata(
    requestId: string,
    ticketId: number,
    patch: TicketMetadataPatch,
  ): Promise<void> {
    const validationError = this.validateMetadataPatchAgainstOptions(patch);
    if (validationError) {
      this.opts.notifyError(requestId, validationError);
      return;
    }

    const ticket = this.tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket) {
      this.opts.notifyError(requestId, "対象チケットが見つかりません。");
      return;
    }
    ensureTicketDraft(
      ticket.id,
      ticket.subject,
      ticket.description ?? "",
      {
        tracker: ticket.trackerName ?? "",
        priority: ticket.priorityName ?? "",
        status: ticket.statusName ?? "",
        due_date: ticket.dueDate ?? "",
        start_date: ticket.startDate ?? "",
      },
      ticket.updatedAt,
    );

    const updated = await this.updateRegisteredTicketEditor(ticket, patch)
      || this.updateQueuedTicket(ticket, patch);
    if (!updated) {
      await this.openEditor(ticketId);
      if (!await this.updateRegisteredTicketEditor(ticket, patch)) {
        this.opts.notifyError(requestId, "更新対象のチケットエディタを特定できません。");
        return;
      }
    }

    this.applyPatchToLocalTicket(ticket, patch);
    this.refreshUnsynced();
    this.pushTickets();
    this.opts.store.update({ selectedTicket: buildTicketDetail(ticket, this.tickets) });
    this.opts.notifySuccess(requestId, "チケット情報を更新しました。同期は既存の同期コマンドで実行されます。");
  }

  private applyPatchToLocalTicket(ticket: Ticket, patch: TicketMetadataPatch): void {
    if (patch.tracker !== undefined) {
      ticket.trackerName = patch.tracker;
      ticket.trackerId = this.opts.store.getState().metadataOptions.trackers
        .find((item) => item.name === patch.tracker)?.id;
    }
    if (patch.priority !== undefined) {
      ticket.priorityName = patch.priority;
      ticket.priorityId = this.opts.store.getState().metadataOptions.priorities
        .find((item) => item.name === patch.priority)?.id;
    }
    if (patch.status !== undefined) {
      ticket.statusName = patch.status;
      ticket.statusId = this.opts.store.getState().metadataOptions.statuses
        .find((item) => item.name === patch.status)?.id;
    }
    if (patch.due_date !== undefined) {
      ticket.dueDate = patch.due_date.length > 0 ? patch.due_date : undefined;
    }
    if (patch.start_date !== undefined) {
      ticket.startDate = patch.start_date.length > 0 ? patch.start_date : undefined;
    }
  }

  private async updateRegisteredTicketEditor(ticket: Ticket, patch: TicketMetadataPatch): Promise<boolean> {
    const record = getTicketEditors(ticket.id).find((candidate) => candidate.contentType === "ticket");
    if (!record) {
      return false;
    }
    const uri = vscode.Uri.parse(record.uri);
    let document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === record.uri);
    if (!document) {
      document = await vscode.workspace.openTextDocument(uri);
      registerTicketDocument(ticket.id, document, "ticket", ticket.projectId);
    }
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === record.uri);
    const parsed = parseTicketEditorContent(document.getText(), {
      allowMissingMetadata: true,
      fallbackMetadata: {
        tracker: ticket.trackerName ?? "",
        priority: ticket.priorityName ?? "",
        status: ticket.statusName ?? "",
        due_date: ticket.dueDate ?? "",
        start_date: ticket.startDate ?? "",
      },
    });
    const next = this.patchEditorContent(parsed, patch);
    const nextText = buildTicketEditorContent(next);
    parseTicketEditorContent(nextText, {
      allowMissingMetadata: true,
      fallbackMetadata: next.metadata,
    });
    if (editor) {
      await applyEditorContent(editor, nextText);
    } else {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(document.uri, fullRange, nextText);
      await vscode.workspace.applyEdit(edit);
    }
    setTicketDraftContent(ticket.id, next);
    markDraftStatus(ticket.id, "Dirty");
    addOfflineTicketUpdate(ticket.id, {
      ticketId: ticket.id,
      baseSubject: ticket.subject,
      baseDescription: ticket.description ?? "",
      baseMetadata: {
        tracker: ticket.trackerName ?? "",
        priority: ticket.priorityName ?? "",
        status: ticket.statusName ?? "",
        due_date: ticket.dueDate ?? "",
        start_date: ticket.startDate ?? "",
      },
      lastKnownRemoteUpdatedAt: ticket.updatedAt,
      subject: next.subject,
      description: next.description,
      metadata: next.metadata,
      layout: next.layout,
      metadataBlock: next.metadataBlock,
    });
    return true;
  }

  private updateQueuedTicket(ticket: Ticket, patch: TicketMetadataPatch): boolean {
    const queued = getOfflineSyncQueue().tickets.get(ticket.id);
    if (!queued) {
      return false;
    }
    const nextMetadata = {
      ...queued.metadata,
      ...(patch.tracker !== undefined ? { tracker: patch.tracker } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
      ...(patch.start_date !== undefined ? { start_date: patch.start_date } : {}),
    };
    const nextContent: TicketEditorContent = {
      subject: queued.subject,
      description: queued.description,
      metadata: nextMetadata,
      layout: queued.layout,
      metadataBlock: queued.metadataBlock,
    };
    parseTicketEditorContent(buildTicketEditorContent(nextContent), {
      allowMissingMetadata: true,
      fallbackMetadata: nextMetadata,
    });
    setTicketDraftContent(ticket.id, nextContent);
    markDraftStatus(ticket.id, "Dirty");
    addOfflineTicketUpdate(ticket.id, {
      ...queued,
      metadata: nextMetadata,
    });
    return true;
  }

  private async loadComments(ticketId: number): Promise<void> {
    const { store } = this.opts;
    store.updateNested("comments", { ticketId, loading: true, error: undefined });
    try {
      const detail = await getIssueDetail(ticketId);
      store.updateNested("comments", {
        loading: false,
        items: buildCommentDashboardItems(detail.comments),
      });
    } catch (err) {
      const msg = (err as Error).message;
      store.updateNested("comments", {
        loading: false,
        error: `Failed to load comments: ${msg}`,
      });
    }
  }

  private async openEditor(ticketId: number): Promise<void> {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (ticket) {
      await showTicketPreview(ticket);
    }
  }

  private async openInBrowser(ticketId: number): Promise<void> {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return;
    }
    await openTicketInBrowser({ ticket });
  }

  private async openCommentInBrowser(
    ticketId: number,
    commentId: number,
    noteIndex?: number,
  ): Promise<void> {
    await openCommentInBrowser({
      comment: {
        id: commentId,
        ticketId,
        authorId: 0,
        authorName: "",
        body: "",
        editableByCurrentUser: false,
        noteIndex,
      },
    });
  }

  private async editTicketComment(ticketId: number, commentId: number): Promise<void> {
    try {
      const detail = await getIssueDetail(ticketId);
      const comment = detail.comments.find((c) => c.id === commentId);
      if (comment) {
        await openCommentUpdateDraft(comment, detail.ticket);
      }
    } catch {
      // コメント編集準備に失敗した場合は無視する
    }
  }

  private async handleSyncOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    if (key.kind === "comment" && key.ticketId === undefined) {
      this.opts.notifyError(requestId, "コメント同期キーが不正です。");
      return;
    }
    this.opts.notifyOperationStarted(requestId, "同期中...");
    const result = await this.syncOne(key);
    this.notifySyncOneResult(requestId, result);
  }

  private async handleSyncSelectedTicket(requestId: string, ticketId: number): Promise<void> {
    const keys = this.buildSelectedTicketSyncKeys(ticketId);
    if (keys.length === 0) {
      const openTicketRecord = getTicketEditors(ticketId)
        .filter((record) => record.contentType === "ticket")
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      if (!openTicketRecord) {
        this.opts.notifySuccess(requestId, "同期する未同期変更はありません。");
        return;
      }
      this.opts.notifyOperationStarted(requestId, "同期中...");
      const status = await vscode.commands.executeCommand<SyncStatus | undefined>(
        "redmine-client.syncOpenEditor",
        { uri: openTicketRecord.uri },
      );
      switch (status) {
        case "uploaded":
          this.opts.notifySuccess(requestId, "同期が完了しました。");
          break;
        case "noChange":
          this.opts.notifySuccess(requestId, "変更はありませんでした。");
          break;
        case "conflict":
          this.opts.notifyError(requestId, "リモートの変更と競合しています。ファイルを開いて確認してください。");
          break;
        case "failed":
        default:
          this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
          break;
      }
      return;
    }

    this.opts.notifyOperationStarted(requestId, "同期中...");
    const results: Array<SyncUnsyncedFileResult | undefined> = [];
    for (const key of keys) {
      results.push(await this.syncOne(key));
    }

    const failures = results.filter(
      (result) => !result || result.status === "failed" || result.status === "conflict",
    );
    if (failures.length > 0) {
      this.opts.notifyError(
        requestId,
        `一部の同期に失敗しました。成功: ${results.length - failures.length}件 / 失敗: ${failures.length}件`,
      );
      return;
    }

    const synced = results.filter((result) => result?.status === "success").length;
    if (synced === 0) {
      this.opts.notifySuccess(requestId, "変更はありませんでした。");
      return;
    }
    this.opts.onTicketsRefreshed();
    this.opts.notifySuccess(requestId, `同期が完了しました。同期: ${synced}件`);
  }

  private async handleSyncNewTicketDraftFromComposer(requestId: string): Promise<void> {
    const queue = getOfflineSyncQueue();
    const entry = queue.newTickets[0];
    this.opts.notifyOperationStarted(requestId, "同期中...");
    if (entry?.documentUri) {
      const result = await this.syncOne({ kind: "newTicket", documentUri: entry.documentUri });
      if (result?.status === "success" && result.kind === "newTicket" && typeof result.id === "number") {
        this.lastCreatedTicketIdFromComposer = result.id;
      }
      this.notifySyncOneResult(requestId, result);
      return;
    }

    const createdTicketId = this.lastCreatedTicketIdFromComposer;
    if (!createdTicketId) {
      this.opts.notifySuccess(requestId, "同期する未同期変更はありません。");
      return;
    }

    const openTicketRecord = getTicketEditors(createdTicketId)
      .filter((record) => record.contentType === "ticket")
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (!openTicketRecord) {
      this.opts.notifySuccess(requestId, "同期する未同期変更はありません。");
      return;
    }

    const status = await vscode.commands.executeCommand<SyncStatus | undefined>(
      "redmine-client.syncOpenEditor",
      { uri: openTicketRecord.uri },
    );
    this.notifySyncStatusResult(requestId, status);
  }

  private notifySyncStatusResult(requestId: string, status: SyncStatus | undefined): void {
    switch (status) {
      case "uploaded":
        this.opts.onTicketsRefreshed();
        this.opts.notifySuccess(requestId, "同期が完了しました。");
        break;
      case "noChange":
        this.opts.notifySuccess(requestId, "変更はありませんでした。");
        break;
      case "conflict":
        this.opts.notifyError(requestId, "リモートの変更と競合しています。ファイルを開いて確認してください。");
        break;
      case "failed":
      default:
        this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private buildSelectedTicketSyncKeys(ticketId: number): DashboardUnsyncedKey[] {
    const queue = getOfflineSyncQueue();
    const keys: DashboardUnsyncedKey[] = [];
    if (queue.tickets.has(ticketId)) {
      keys.push({ kind: "ticket", ticketId });
    }
    for (const comment of queue.comments) {
      if (comment.ticketId !== ticketId) {
        continue;
      }
      keys.push({
        kind: "comment",
        ticketId,
        commentId: comment.commentId,
        documentUri: comment.documentUri,
      });
    }
    return keys;
  }

  private async handleDiscardOne(requestId: string, key: DashboardUnsyncedKey): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "この未同期のローカル変更を破棄します。Redmineサーバ上のチケットは削除されません。",
      { modal: true },
      "破棄",
    );
    if (confirmed !== "破棄") {
      return;
    }

    if (key.kind === "ticket") {
      removeOfflineTicketUpdate(key.ticketId);
    } else if (key.kind === "newTicket") {
      if (!key.documentUri) {
        this.opts.notifyError(requestId, "対象の新規チケット下書きを特定できません。");
        return;
      }
      removeOfflineNewTicket(key.documentUri);
    } else if (key.kind === "comment") {
      removeOfflineCommentEntry({ commentId: key.commentId, documentUri: key.documentUri });
    }

    this.refreshUnsynced();
    this.refreshTicketPresentation();
    this.opts.notifySuccess(requestId, "未同期のローカル変更を破棄しました。");
  }

  private notifySyncOneResult(requestId: string, result: SyncUnsyncedFileResult | undefined): void {
    if (!result) {
      this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
      return;
    }
    switch (result.status) {
      case "success":
        this.opts.onTicketsRefreshed();
        this.opts.notifySuccess(requestId, "同期が完了しました。");
        break;
      case "no_change":
        this.opts.notifySuccess(requestId, "変更はありませんでした。");
        break;
      case "conflict":
        this.opts.notifyError(requestId, "リモートの変更と競合しています。ファイルを開いて確認してください。");
        break;
      case "failed":
        this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private async handleSyncAll(requestId: string): Promise<void> {
    this.opts.notifyOperationStarted(requestId, "全件同期中...");
    const result = await runOfflineSync();
    this.opts.onTicketsRefreshed();
    this.refreshUnsynced();
    this.refreshTicketPresentation();
    this.notifySyncAllResult(requestId, result);
  }

  private notifySyncAllResult(requestId: string, result: OfflineSyncRunResult): void {
    switch (result.status) {
      case "nothing_to_sync":
        this.opts.notifySuccess(requestId, "同期するものはありません。");
        break;
      case "success":
        this.opts.notifySuccess(requestId, `全件同期が完了しました。同期: ${result.synced}件`);
        break;
      case "partial_failure":
        this.opts.notifyError(
          requestId,
          `一部の同期に失敗しました。成功: ${result.synced}件 / 失敗: ${result.failed}件 / 競合: ${result.conflicts}件`,
        );
        break;
      case "cancelled":
        this.opts.notifyError(
          requestId,
          `同期をキャンセルしました。成功: ${result.synced}件 / 未完了: ${result.failed}件`,
        );
        break;
      case "failed":
        this.opts.notifyError(requestId, "同期に失敗しました。VS Code の通知をご確認ください。");
        break;
    }
  }

  private async syncOne(key: DashboardUnsyncedKey): Promise<SyncUnsyncedFileResult | undefined> {
    let syncKey: UnsyncedFileSyncKey | undefined;

    if (key.kind === "ticket" && key.ticketId !== undefined) {
      syncKey = { kind: "ticket", ticketId: key.ticketId };
    } else if (key.kind === "newTicket") {
      syncKey = { kind: "newTicket", documentUri: key.documentUri };
    } else if (key.kind === "comment" && key.ticketId !== undefined) {
      syncKey = {
        kind: "comment",
        ticketId: key.ticketId,
        commentId: key.commentId,
        documentUri: key.documentUri,
      };
    }

    if (!syncKey) {
      return undefined;
    }

    const result = await syncUnsyncedFile(
      { syncKey },
      { onTicketCreated: () => this.opts.onTicketsRefreshed() },
    );
    this.refreshUnsynced();
    this.refreshTicketPresentation();
    return result;
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

  private async openNewTicketComposer(): Promise<void> {
    this.lastCreatedTicketIdFromComposer = undefined;
    const project = this.getResolvedProject();
    if (!project) {
      this.opts.notifyToast("warning", "チケット作成前にプロジェクトを選択してください。");
      return;
    }
    const defaults = this.opts.store.getState().metadataOptions;
    this.opts.store.update({
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

  private async openChildTicketComposer(parentTicketId: number): Promise<void> {
    this.lastCreatedTicketIdFromComposer = undefined;
    const parent = this.tickets.find((t) => t.id === parentTicketId);
    if (!parent) {
      this.opts.notifyError("ticket.createChild", "親チケットが見つかりません。");
      return;
    }
    if (!parent.projectId) {
      this.opts.notifyError("ticket.createChild", "親チケットのプロジェクト情報が不足しています。");
      return;
    }
    const projectName = parent.projectName ?? String(parent.projectId);
    const defaults = this.opts.store.getState().metadataOptions;
    this.opts.store.update({
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

  private async loadComposerTrackers(
    projectId: number,
    parentTicket?: Ticket,
  ): Promise<void> {
    try {
      const trackers = await getProjectTrackers(projectId);
      if (trackers.length === 0) {
        this.updateWorkPanelComposer({ loading: false, trackers: [], error: "このプロジェクトにはトラッカーが設定されていません。" });
        return;
      }
      const defaults = this.opts.store.getState().metadataOptions;
      const firstTracker = trackers[0]?.name;
      const defaultTracker = this.suggestDefaultTracker(trackers, parentTicket?.trackerName) ?? firstTracker;
      const defaultPriority = this.pickOptionName(defaults.priorities, parentTicket?.priorityName) ?? defaults.priorities[0]?.name;
      const defaultStatus = this.pickOptionName(defaults.statuses, parentTicket?.statusName) ?? defaults.statuses[0]?.name;
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
      this.updateWorkPanelComposer({ loading: false, trackers: [], error: `トラッカーの取得に失敗しました: ${msg}` });
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
    const defaultTracker = this.opts.store.getState().metadataOptions.trackers
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
      error?: string;
    },
  ): void {
    const current = this.opts.store.getState().workPanel;
    if (!current || (current.mode !== "newTicket" && current.mode !== "childTicket")) {
      return;
    }
    if (current.mode === "newTicket") {
      this.opts.store.update({ workPanel: { ...current, ...patch, mode: "newTicket" } });
      return;
    }
    this.opts.store.update({ workPanel: { ...current, ...patch, mode: "childTicket" } });
  }

  private cancelComposer(): void {
    const selectedTicketId = this.opts.store.getState().selectedTicketId;
    if (selectedTicketId) {
      this.opts.store.update({ workPanel: { mode: "detail", ticketId: selectedTicketId } });
      return;
    }
    this.opts.store.update({ workPanel: undefined });
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
      return "プロジェクトが選択されていません。";
    }
    if (!values.tracker.trim()) {
      return "トラッカーを選択してください。";
    }
    if (!panel.trackers.some((tracker) => tracker.name === values.tracker)) {
      return `このプロジェクトでは使用できないトラッカーです: ${values.tracker}`;
    }
    if (!values.priority.trim()) {
      return "優先度を選択してください。";
    }
    if (!values.status.trim()) {
      return "ステータスを選択してください。";
    }
    const isValidDate = (value?: string): boolean =>
      value === undefined || value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isValidDate(values.start_date)) {
      return "開始日の形式が不正です（YYYY-MM-DD）。";
    }
    if (!isValidDate(values.due_date)) {
      return "期日の形式が不正です（YYYY-MM-DD）。";
    }
    if (panel.mode === "childTicket" && !panel.parentTicketId) {
      return "親チケット情報が不足しています。";
    }
    return undefined;
  }

  private async createDraftFromComposer(
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
    const workPanel = this.opts.store.getState().workPanel;
    if (!workPanel || (workPanel.mode !== "newTicket" && workPanel.mode !== "childTicket")) {
      this.opts.notifyError(requestId, "チケット作成パネルが開いていません。");
      return;
    }
    const validationError = this.validateComposerValues(workPanel, values);
    if (validationError) {
      this.updateWorkPanelComposer({ error: validationError });
      return;
    }
    try {
      await openNewTicketDraft({
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
    } catch (err) {
      const msg = (err as Error).message;
      this.opts.notifyError(requestId, `ドラフトの作成に失敗しました: ${msg}`);
    }
  }

  private refreshUnsynced(): void {
    const items = buildUnsyncedDashboardItems();
    this.opts.store.updateNested("unsynced", {
      totalCount: items.length,
      items,
    });
  }

  private refreshTicketPresentation(): void {
    this.pushTickets();
    const selectedTicketId = this.opts.store.getState().selectedTicketId;
    if (selectedTicketId === undefined) {
      return;
    }
    const selectedTicket = this.tickets.find((ticket) => ticket.id === selectedTicketId);
    if (selectedTicket) {
      this.opts.store.update({ selectedTicket: buildTicketDetail(selectedTicket, this.tickets) });
    }
  }

  private pushTickets(): void {
    const settings = this.settingsCtrl.getSettings();
    const filtered = applyTicketFilters(this.tickets, settings.filters);
    const sorted = applyTicketSort(filtered, settings.sort);
    const nodes = buildTicketDashboardNodes(sorted);
    this.opts.store.update({
      tickets: nodes,
      totalTicketCount: this.totalCount,
      loadedTicketCount: this.tickets.length,
    });
  }
}
