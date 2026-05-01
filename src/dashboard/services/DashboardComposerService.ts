import type { DashboardServiceContext } from "./DashboardServiceContext";
import * as vscode from "vscode";
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
      this.deps.context.notifyToast("warning", "チケット作成前にプロジェクトを選択してください。");
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
      this.deps.context.notifyError("ticket.createChild", "親チケットが見つかりません。");
      return;
    }
    if (!parent.projectId) {
      this.deps.context.notifyError("ticket.createChild", "親チケットのプロジェクト情報が不足しています。");
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
      this.deps.context.notifyError(requestId, "チケット作成パネルが開いていません。");
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
      this.deps.context.notifyError(requestId, `ドラフトの作成に失敗しました: ${msg}`);
    }
  }

  async handleSyncNewTicketDraftFromComposer(
    requestId: string,
    hooks?: {
      syncFn?: (editor: vscode.TextEditor) => Promise<TicketSaveResult>;
      getTicketIdFn?: (editor: vscode.TextEditor) => number | undefined;
      findEditorFn?: (draftUri: string) => vscode.TextEditor | undefined;
      openEditorFn?: (uri: vscode.Uri) => Promise<vscode.TextEditor>;
      afterCreatedFn?: (createdId: number) => Promise<void>;
    },
  ): Promise<void> {
    const workPanel = this.deps.context.store.getState().workPanel;
    if (!workPanel || (workPanel.mode !== "newTicket" && workPanel.mode !== "childTicket")) {
      this.deps.context.notifyError(requestId, "コンポーザーが開いていません。");
      return;
    }

    const draftUri = workPanel.draftUri;
    if (!draftUri) {
      this.deps.context.notifyError(requestId, "下書きファイルがまだ作成されていません。まずドラフトを作成してください。");
      return;
    }

    this.deps.context.notifyOperationStarted(requestId, "同期中...");

    const findEditorFn = hooks?.findEditorFn ??
      ((uri: string) => vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri));
    const openEditorFn = hooks?.openEditorFn ??
      (async (uri: vscode.Uri): Promise<vscode.TextEditor> => {
        const doc = await vscode.workspace.openTextDocument(uri);
        return vscode.window.showTextDocument(doc, { preview: false });
      });
    const syncFn = hooks?.syncFn ?? ((editor: vscode.TextEditor) => syncNewTicketDraft({ editor }));
    const getTicketIdFn = hooks?.getTicketIdFn ?? getTicketIdForEditor;

    let editor = findEditorFn(draftUri);
    if (!editor) {
      editor = await openEditorFn(vscode.Uri.parse(draftUri));
    }

    const result = await syncFn(editor);

    if (result.status === "created") {
      const createdId = getTicketIdFn(editor);
      removeOfflineNewTicket(draftUri);
      this.deps.refreshUnsynced();
      if (hooks?.afterCreatedFn) {
        await hooks.afterCreatedFn(createdId ?? 0);
        this.deps.context.onTicketsRefreshed();
        this.deps.context.notifySuccess(requestId, "チケットを作成しました。");
      } else {
        await this.deps.loadTickets();
        this.deps.context.onTicketsRefreshed();
        if (createdId !== undefined && createdId > 0) {
          this.deps.context.store.update({ workPanel: { mode: "detail", ticketId: createdId } });
          await this.deps.selectTicket(createdId);
          this.deps.context.notifySuccess(requestId, "チケットを作成しました。");
        } else {
          this.deps.context.notifySuccess(
            requestId,
            "チケットを作成しました。ただし作成後のチケットIDを特定できなかったため、一覧を更新して確認してください。",
          );
        }
      }
      return;
    }

    if (result.status === "failed") {
      const raw = result.message ?? "不明なエラー";
      const displayMsg = raw === "Ticket subject is required."
        ? "件名が未入力です。Markdownの「# 」見出し行に件名を入力してから同期してください。"
        : `同期に失敗しました: ${raw}`;
      this.deps.context.notifyError(requestId, displayMsg);
      return;
    }

    if (result.status === "queued") {
      this.deps.context.notifySuccess(requestId, "オフライン同期キューに追加しました。");
      return;
    }

    if (result.status === "no_change") {
      this.deps.context.notifySuccess(requestId, "変更はありませんでした。");
      return;
    }

    this.deps.context.notifyError(requestId, `同期に失敗しました: ${result.message ?? "不明なエラー"}`);
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
        this.updateWorkPanelComposer({ loading: false, trackers: [], error: "このプロジェクトにはトラッカーが設定されていません。" });
        return;
      }
      const defaults = this.deps.context.store.getState().metadataOptions;
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
}
