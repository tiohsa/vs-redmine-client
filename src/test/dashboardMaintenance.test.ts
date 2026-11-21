import * as assert from "assert";
import { runInNewContext } from "vm";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";
import type { DashboardMetadataOption, DashboardProjectNode, DashboardStatusMetadata } from "../dashboard/dashboardProtocol";
import type { DashboardTicketNode } from "../dashboard/dashboardProtocol";
import type { Ticket } from "../redmine/types";
import type { DurableSyncEffect } from "../app/syncEffects";
import { getCurrentConnectionScope } from "../config/connectionScope";
import { clearTicketSummaries, getTicketSummary, rememberTicketSummary } from "../views/ticketSummaryStore";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";
import { createTestMemento } from "./helpers/vscodeMemento";
import {
  getCommentDraftState,
  setCommentDraft,
  clearCommentDrafts,
} from "../views/commentDraftStore";
import {
  getCommentEdit,
  initializeCommentEdit,
  setCommentDraftBody,
  clearCommentEdits,
} from "../views/commentEditStore";
import {
  clearTicketDrafts,
  getTicketDraft,
  initializeDraftStore,
  initializeTicketDraft,
  setTicketDraftContent,
} from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import {
  createNewTicketDraft,
  getAllNewTicketDrafts,
  initializeNewTicketDraftStore,
  clearNewTicketDrafts,
} from "../views/newTicketDraftStore";
import {
  getOfflineSyncQueue,
  initializeOfflineSyncStore,
  replaceOfflineSyncQueueAsync,
  type OfflineCommentUpdate,
  type OfflineNewTicket,
  type OfflineSyncQueue,
  type OfflineTicketUpdate,
} from "../views/offlineSyncStore";

const ticketId = 410;
const commentId = 511;
const scope = getCurrentConnectionScope();
const metadata = buildIssueMetadataFixture();

const effect = (effectId: string): DurableSyncEffect => ({
  effectId,
  kind: "attachment_upload",
  operationRevision: 4,
  attemptGeneration: 3,
  state: "commit_unknown",
  target: { filePath: "/local/attachment.png" },
});

const queueFixture = (): OfflineSyncQueue => {
  const ticket = (
    id: number,
    phase: OfflineTicketUpdate["phase"],
    revision: number,
    unsafe = false,
  ): OfflineTicketUpdate => ({
    ticketId: id,
    baseSubject: "Remote subject",
    baseDescription: "Remote body",
    baseMetadata: metadata,
    subject: "Local subject",
    description: "Local body",
    metadata,
    operationId: `ticket:${id}`,
    connectionScope: scope,
    phase,
    revision,
    intentRevision: revision,
    attemptGeneration: 3,
    effects: unsafe ? [effect(`ticket-effect:${id}`)] : [],
    nextIntent: unsafe
      ? { revision: revision + 1, subject: "Later subject", description: "Later body", metadata }
      : undefined,
  });
  const comment = (
    id: number,
    phase: OfflineCommentUpdate["phase"],
    revision: number,
    unsafe = false,
  ): OfflineCommentUpdate => ({
    ticketId,
    commentId: id,
    body: "Queued comment",
    operationId: `comment:${id}`,
    connectionScope: scope,
    phase,
    revision,
    intentRevision: revision,
    attemptGeneration: 3,
    effects: unsafe ? [effect(`comment-effect:${id}`)] : [],
    nextIntent: unsafe ? { revision: revision + 1, body: "Later comment" } : undefined,
  });
  const newTicket = (
    queueId: string,
    phase: OfflineNewTicket["phase"],
    revision: number,
    unsafe = false,
  ): OfflineNewTicket => ({
    queueId,
    content: "# New ticket draft",
    documentUri: `file:///tmp/${queueId}.md`,
    operationId: queueId,
    connectionScope: scope,
    phase,
    revision,
    attemptGeneration: 3,
    effects: unsafe ? [effect(`new-ticket-effect:${queueId}`)] : [],
    nextIntent: unsafe ? { revision: revision + 1, content: "# Later draft" } : undefined,
  });

  return {
    tickets: new Map([
      [ticketId, ticket(ticketId, "queued", 2)],
      [ticketId + 1, ticket(ticketId + 1, "commit_unknown", 4, true)],
    ]),
    comments: [
      comment(commentId - 1, "queued", 2),
      comment(commentId, "reconciliation_pending", 4, true),
    ],
    newTickets: [
      newTicket("new-ticket-queued", "queued", 2),
      newTicket("new-ticket-unknown", "commit_unknown", 4, true),
    ],
  };
};

const localWorkSnapshot = () => structuredClone({
  ticketDraft: getTicketDraft(ticketId, scope),
  commentDraft: getCommentDraftState(ticketId, scope),
  commentEdit: getCommentEdit(commentId, scope),
  newTicketDrafts: getAllNewTicketDrafts(),
  queue: getOfflineSyncQueue(scope),
});

const resetLocalStores = (): void => {
  clearTicketDrafts(scope);
  clearCommentDrafts();
  clearCommentEdits();
  clearNewTicketDrafts();
  initializeDraftStore(createInMemoryDraftStorage(), scope);
  initializeNewTicketDraftStore(createTestMemento());
  initializeOfflineSyncStore(createTestMemento(), scope);
};

const seedLocalWork = async (): Promise<{ queueWrites: () => number }> => {
  resetLocalStores();
  initializeTicketDraft(ticketId, "Remote subject", "Remote body", metadata, "2026-09-22T00:00:00Z", scope);
  setTicketDraftContent(ticketId, {
    subject: "Edited subject",
    description: "Local ticket draft",
    metadata,
  }, scope);
  setCommentDraft(ticketId, "Local comment draft", scope);
  initializeCommentEdit(commentId, ticketId, "Remote comment", "2026-09-22T00:00:00Z", scope);
  setCommentDraftBody(commentId, "Edited comment", scope);
  createNewTicketDraft(1, "Local new-ticket draft");

  const storage = createTestMemento();
  let writes = 0;
  const originalUpdate = storage.update.bind(storage);
  storage.update = async (key, value) => {
    writes++;
    await originalUpdate(key, value);
  };
  initializeOfflineSyncStore(storage, scope);
  await replaceOfflineSyncQueueAsync(queueFixture(), scope);
  return { queueWrites: () => writes };
};

const makeController = (
  store: DashboardStateStore,
  events: string[],
  confirm = true,
): DashboardController => new DashboardController({
  store,
  notifyOperationStarted: (_requestId, label) => events.push(`started:${label ?? ""}`),
  notifySuccess: (_requestId, message) => events.push(`success:${message}`),
  notifyError: (_requestId, message) => events.push(`error:${message}`),
  notifyToast: () => undefined,
  onTicketsRefreshed: () => undefined,
  _maintenanceTestHooks: { confirmDashboardCacheReset: async () => confirm },
});

const installReloadStubs = (
  controller: DashboardController,
  store: DashboardStateStore,
  events: string[],
  failure?: Error,
  onTicketLoad?: () => void,
): { invalidations: string[] } => {
  const invalidations: string[] = [];
  controller["projectService"].invalidate = () => invalidations.push("projects");
  controller["ticketService"].invalidate = () => invalidations.push("tickets");
  controller["commentService"].invalidate = () => invalidations.push("comments");
  controller["metadataService"].invalidate = () => invalidations.push("metadata");
  controller["projectService"].loadProjects = async () => {
    events.push("projects");
    store.update({ projects: [{ id: 1, name: "Fresh", identifier: "fresh", level: 0 }] });
  };
  controller["dataService"].loadMetadataOptions = async () => {
    events.push("metadata-options");
    const option: DashboardMetadataOption = { id: 1, name: "Fresh option" };
    const status: DashboardStatusMetadata = { ...option, isClosed: false };
    store.update({
      currentUserId: 77,
      metadataOptions: { trackers: [option], priorities: [option], statuses: [status] },
    });
    if (failure?.message === "Metadata unavailable") {
      throw failure;
    }
  };
  controller["ticketService"].loadTickets = async () => {
    events.push("tickets");
    if (failure && failure.message !== "Metadata unavailable") {
      throw failure;
    }
    onTicketLoad?.();
    store.update({
      tickets: [],
      totalTicketCount: 0,
      loadedTicketCount: 0,
    });
  };
  controller["pushTickets"] = () => {
    events.push("filter-metadata-rebuilt");
    store.update({ ticketFilterOptions: { assignees: [], statuses: store.getState().metadataOptions.statuses } });
  };
  controller["refreshUnsynced"] = () => events.push("unsynced-refreshed");
  return { invalidations };
};

suite("Dashboard maintenance", () => {
  teardown(() => {
    resetLocalStores();
    clearTicketSummaries();
  });

  test("Reset Dashboard Cache はキャッシュだけを再取得し、ローカル作業と同期 checkpoint を保持する", async () => {
    const localStorage = await seedLocalWork();
    const beforeWork = localWorkSnapshot();
    const store = new DashboardStateStore();
    const events: string[] = [];
    const controller = makeController(store, events);
    const { invalidations } = installReloadStubs(controller, store, events);
    store.update({
      selectedProject: { id: 1, name: "Selected" },
      currentUserId: 42,
      projects: [{ id: 1, name: "Old", identifier: "old", level: 0 }],
      settings: { ...store.getState().settings, baseUrl: "https://redmine.example/", apiKeyStatus: "set" },
      unsynced: { totalCount: 3, items: [
        { key: { kind: "ticket", ticketId }, label: "Queued" },
        { key: { kind: "comment", ticketId, commentId }, label: "Recovery", lifecycle: "recovery_pending" },
        { key: { kind: "newTicket", queueId: "new-ticket-unknown" }, label: "Unknown", lifecycle: "commit_unknown" },
      ] },
    });
    const beforeSettings = structuredClone(store.getState().settings);
    const beforeUnsynced = structuredClone(store.getState().unsynced);
    const beforeProject = structuredClone(store.getState().selectedProject);
    const beforeWrites = localStorage.queueWrites();

    await controller.handle({ type: "dashboard.resetCache", requestId: "reset-cache" });

    assert.deepStrictEqual(localWorkSnapshot(), beforeWork);
    assert.strictEqual(localStorage.queueWrites(), beforeWrites);
    assert.deepStrictEqual(store.getState().settings, beforeSettings);
    assert.deepStrictEqual(store.getState().unsynced, beforeUnsynced);
    assert.deepStrictEqual(store.getState().selectedProject, beforeProject);
    assert.deepStrictEqual(invalidations.sort(), ["comments", "metadata", "projects", "tickets"]);
    assert.ok(events.includes("projects"));
    assert.ok(events.includes("metadata-options"));
    assert.ok(events.includes("tickets"));
    assert.ok(events.includes("filter-metadata-rebuilt"));
    assert.ok(events.includes("unsynced-refreshed"));
    assert.ok(events.some((event) => event.startsWith("started:")));
    assert.ok(events.some((event) => event.startsWith("success:")));
    assert.strictEqual(events.some((event) => event.startsWith("error:")), false);

    const queue = getOfflineSyncQueue(scope);
    assert.strictEqual(queue.tickets.get(ticketId + 1)?.phase, "commit_unknown");
    assert.strictEqual(queue.tickets.get(ticketId + 1)?.nextIntent?.revision, 5);
    assert.strictEqual(queue.comments[1]?.phase, "reconciliation_pending");
    assert.strictEqual(queue.comments[1]?.effects?.[0]?.state, "commit_unknown");
    assert.strictEqual(queue.newTickets[1]?.phase, "commit_unknown");
    assert.strictEqual(queue.newTickets[1]?.nextIntent?.revision, 5);
    controller.dispose();
  });

  test("再取得失敗は通知し、ドラフト・キュー・API key 表示を保持する", async () => {
    const localStorage = await seedLocalWork();
    const beforeWork = localWorkSnapshot();
    const beforeWrites = localStorage.queueWrites();
    const store = new DashboardStateStore();
    const events: string[] = [];
    const controller = makeController(store, events);
    const previousTicket: Ticket = {
      id: ticketId,
      subject: "Previously loaded ticket",
      description: "Previous description",
      projectId: 1,
      updatedAt: "2026-09-22T00:00:00Z",
    };
    const previousProject: DashboardProjectNode = { id: 1, name: "Previously loaded project", identifier: "previous", level: 0 };
    const previousTicketNode: DashboardTicketNode = {
      id: ticketId,
      subject: previousTicket.subject,
      syncState: "Synced",
      children: [],
      level: 0,
    };
    const cache = controller["cache"];
    cache.tickets = [previousTicket];
    cache.projects = [previousProject];
    cache.totalCount = 1;
    store.update({
      settings: { ...store.getState().settings, baseUrl: "https://redmine.example/", apiKeyStatus: "set" },
      selectedProject: { id: 1, name: previousProject.name },
      projects: [previousProject],
      tickets: [previousTicketNode],
      totalTicketCount: 1,
      loadedTicketCount: 1,
      selectedTicketId: ticketId,
      selectedTicket: { id: ticketId, subject: previousTicket.subject, syncState: "Synced" },
      quickFilterCapabilities: { mine: "available", open: "available" },
    });
    const beforePresentation = structuredClone(store.getState());
    const beforeSettings = structuredClone(store.getState().settings);
    installReloadStubs(controller, store, events, new Error("Redmine is offline"));
    const reloadProjects = controller["projectService"].loadProjects;
    controller["projectService"].loadProjects = async () => {
      await reloadProjects();
      cache.projects = store.getState().projects;
      cache.tickets = [];
      cache.totalCount = 0;
    };

    await controller.handle({ type: "dashboard.resetCache", requestId: "reset-cache-failure" });

    assert.deepStrictEqual(localWorkSnapshot(), beforeWork);
    assert.strictEqual(localStorage.queueWrites(), beforeWrites);
    assert.deepStrictEqual(store.getState().settings, beforeSettings);
    assert.deepStrictEqual(store.getState().projects, beforePresentation.projects);
    assert.deepStrictEqual(store.getState().tickets, beforePresentation.tickets);
    assert.strictEqual(store.getState().totalTicketCount, beforePresentation.totalTicketCount);
    assert.strictEqual(store.getState().loadedTicketCount, beforePresentation.loadedTicketCount);
    assert.strictEqual(store.getState().selectedTicketId, beforePresentation.selectedTicketId);
    assert.deepStrictEqual(store.getState().selectedTicket, beforePresentation.selectedTicket);
    assert.deepStrictEqual(cache.tickets, [previousTicket]);
    assert.deepStrictEqual(cache.projects, [previousProject]);
    assert.strictEqual(cache.totalCount, 1);
    assert.ok(events.some((event) => event.includes("Redmine is offline")));
    assert.strictEqual(events.some((event) => event.startsWith("success:")), false);
    controller.dispose();
  });

  test("一部の一覧を読み込んだ後に失敗してもチケット要約キャッシュを戻す", async () => {
    await seedLocalWork();
    const previousTicket: Ticket = {
      id: ticketId,
      subject: "Previously loaded ticket",
      description: "Previous description",
      projectId: 1,
      updatedAt: "2026-09-22T00:00:00Z",
    };
    rememberTicketSummary(previousTicket);
    const store = new DashboardStateStore();
    const events: string[] = [];
    const controller = makeController(store, events);
    installReloadStubs(
      controller,
      store,
      events,
      new Error("Metadata unavailable"),
      () => rememberTicketSummary({ ...previousTicket, id: ticketId + 1, subject: "Partially loaded ticket" }),
    );

    await controller.handle({ type: "dashboard.resetCache", requestId: "reset-cache-partial-failure" });

    assert.strictEqual(getTicketSummary(ticketId), "Previously loaded ticket");
    assert.strictEqual(getTicketSummary(ticketId + 1), undefined);
    assert.ok(events.some((event) => event.includes("Metadata unavailable")));
    controller.dispose();
  });

  test("metadata の再取得失敗も明示し、ローカル作業を保持する", async () => {
    const localStorage = await seedLocalWork();
    const beforeWork = localWorkSnapshot();
    const beforeWrites = localStorage.queueWrites();
    const store = new DashboardStateStore();
    const events: string[] = [];
    const controller = makeController(store, events);
    store.update({ settings: { ...store.getState().settings, baseUrl: "https://redmine.example/", apiKeyStatus: "set" } });
    const beforeSettings = structuredClone(store.getState().settings);
    installReloadStubs(controller, store, events, new Error("Metadata unavailable"));

    await controller.handle({ type: "dashboard.resetCache", requestId: "reset-cache-metadata-failure" });

    assert.deepStrictEqual(localWorkSnapshot(), beforeWork);
    assert.strictEqual(localStorage.queueWrites(), beforeWrites);
    assert.deepStrictEqual(store.getState().settings, beforeSettings);
    assert.ok(events.some((event) => event.includes("Metadata unavailable")));
    assert.strictEqual(events.some((event) => event.startsWith("success:")), false);
    controller.dispose();
  });

  test("確認をキャンセルするとキャッシュもローカルデータも変更しない", async () => {
    const beforeWork = await seedLocalWork().then(() => localWorkSnapshot());
    const store = new DashboardStateStore();
    const events: string[] = [];
    const controller = makeController(store, events, false);
    const { invalidations } = installReloadStubs(controller, store, events);

    await controller.handle({ type: "dashboard.resetCache", requestId: "cancel-reset" });

    assert.deepStrictEqual(localWorkSnapshot(), beforeWork);
    assert.deepStrictEqual(invalidations, []);
    assert.deepStrictEqual(events, []);
    controller.dispose();
  });

  test("Reset View State は Webview の UI preferences だけを既定値へ戻す", () => {
    const functionStart = dashboardWebviewScript.indexOf("function resetViewState(){");
    const functionEnd = dashboardWebviewScript.indexOf("\nfunction renderSettings()", functionStart);
    assert.ok(functionStart >= 0 && functionEnd > functionStart);
    const closeStart = dashboardWebviewScript.indexOf("function closeProjectPicker(returnFocus){");
    const closeEnd = dashboardWebviewScript.indexOf("\nfunction openProjectPicker()", closeStart);
    assert.ok(closeStart >= 0 && closeEnd > closeStart);
    const source = `${dashboardWebviewScript.slice(closeStart, closeEnd)}\n${dashboardWebviewScript.slice(functionStart, functionEnd)}`;

    let savedState: Record<string, unknown> = {
      ticketLayoutMode: "split",
      detailFocus: true,
      detailTab: "comments",
      quickFilters: ["mine", "open"],
      retainedExtensionState: "keep",
    };
    let renderCount = 0;
    let toastMessage = "";
    const searchInput = { value: "filtered" };
    const projectSearchInput = { value: "nagoya", setAttribute: () => undefined, removeAttribute: () => undefined };
    const projectPickerPopup = { hidden: false };
    const filterDialog = { classList: { add: () => undefined } };
    const snapshot = runInNewContext(`${source}\nresetViewState(); JSON.stringify({
      ticketLayoutMode, detailFocus, quickFilters: Array.from(quickFilters),
      expanded: Array.from(expandedTicketIds), collapsed: Array.from(collapsedTicketIds),
      expandedComments: Array.from(expandedComments), ticketDetailExpanded, metadataExpanded,
      searchQuery, searchValue: searchInput.value, searchTimer,
      projectSearchQuery, projectSearchValue: projectSearchInput.value,
      projectPickerOpen, projectPickerHidden: projectPickerPopup.hidden, projectSearchComposing,
      selectedProjectId: state.selectedProject.id,
    });`, {
      ticketLayoutMode: "split",
      detailFocus: true,
      quickFilters: new Set(["mine", "open"]),
      expandedTicketIds: new Set([410]),
      collapsedTicketIds: new Set([411]),
      expandedComments: new Set(["410:511"]),
      ticketDetailExpanded: true,
      metadataExpanded: true,
      activeTicketActionMenuId: "menu-410",
      activeTicketActionAnchorTop: 22,
      searchQuery: "filtered",
      projectSearchQuery: "nagoya",
      searchTimer: 99,
      searchInput,
      projectSearchInput,
      projectPickerOpen: true,
      projectPickerPopup,
      projectSelectTrigger: { setAttribute: () => undefined },
      projectSearchComposing: true,
      activeProjectId: 3,
      renderProjectSelect: () => undefined,
      filterDialog,
      state: { selectedProject: { id: 1 } },
      vscode: {
        getState: () => savedState,
        setState: (state: Record<string, unknown>) => { savedState = state; },
      },
      STRINGS: { viewStateReset: "view state reset" },
      window: { clearTimeout: () => undefined },
      document: { getElementById: () => searchInput, querySelectorAll: () => [] },
      updateSearchClearButton: () => undefined,
      submitSearch: () => undefined,
      closeLayoutPopover: () => undefined,
      req: () => undefined,
      render: () => { renderCount++; },
      applyTicketLayoutMode: () => undefined,
      showToast: (_level: string, message: string) => { toastMessage = message; },
    }) as string;

    assert.deepStrictEqual(JSON.parse(snapshot), {
      ticketLayoutMode: "auto",
      detailFocus: false,
      quickFilters: ["open"],
      expanded: [],
      collapsed: [],
      expandedComments: [],
      ticketDetailExpanded: true,
      metadataExpanded: true,
      searchQuery: "",
      searchValue: "",
      searchTimer: null,
      projectSearchQuery: "",
      projectSearchValue: "",
      projectPickerOpen: false,
      projectPickerHidden: true,
      projectSearchComposing: false,
      selectedProjectId: 1,
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(savedState)), {
      ticketLayoutMode: "auto",
      detailFocus: false,
      compactMode: false,
      quickFilters: ["open"],
      retainedExtensionState: "keep",
    });
    assert.strictEqual(renderCount, 1);
    assert.strictEqual(toastMessage, "view state reset");
  });

  test("Maintenance actions use native buttons and the validated cache-reset request", () => {
    assert.ok(dashboardWebviewScript.includes('id="dashboard-cache-reset-btn" type="button"'));
    assert.ok(dashboardWebviewScript.includes('id="settings-reset-view-btn" type="button"'));
    assert.ok(dashboardWebviewScript.includes("req('dashboard.resetCache')"));
    assert.ok(dashboardWebviewScript.includes("addEventListener('click',resetViewState)"));
  });
});
