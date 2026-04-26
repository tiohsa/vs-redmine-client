import * as assert from "assert";
import { Ticket } from "../redmine/types";
import {
  buildTicketDashboardNodes,
  buildTicketDetail,
  resolveTicketSyncState,
} from "../dashboard/viewModels/ticketDashboardViewModel";
import { buildUnsyncedDashboardItems } from "../dashboard/viewModels/unsyncedDashboardViewModel";
import {
  clearOfflineSyncQueue,
  replaceOfflineSyncQueue,
} from "../views/offlineSyncStore";
import {
  clearTicketDrafts,
  markDraftStatus,
  initializeTicketDraft,
} from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";

const makeTicket = (overrides: Partial<Ticket> & { id: number }): Ticket => ({
  id: overrides.id,
  subject: overrides.subject ?? `Ticket #${overrides.id}`,
  projectId: overrides.projectId ?? 1,
  statusName: overrides.statusName,
  statusId: overrides.statusId,
  priorityName: overrides.priorityName,
  priorityId: overrides.priorityId,
  trackerName: overrides.trackerName,
  trackerId: overrides.trackerId,
  assigneeName: overrides.assigneeName,
  assigneeId: overrides.assigneeId,
  dueDate: overrides.dueDate,
  parentId: overrides.parentId,
  description: overrides.description,
});

suite("Dashboard ViewModel — チケット変換", () => {
  setup(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
    initializeDraftStoreForTests();
  });

  teardown(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
  });

  test("空リストは空配列を返す", () => {
    const result = buildTicketDashboardNodes([]);
    assert.deepStrictEqual(result, []);
  });

  test("フラットなチケットをノードに変換する", () => {
    const tickets = [makeTicket({ id: 1 }), makeTicket({ id: 2 })];
    const nodes = buildTicketDashboardNodes(tickets);
    assert.strictEqual(nodes.length, 2);
    assert.strictEqual(nodes[0].id, 1);
    assert.strictEqual(nodes[1].id, 2);
    assert.strictEqual(nodes[0].level, 0);
    assert.strictEqual(nodes[1].level, 0);
    assert.deepStrictEqual(nodes[0].children, []);
  });

  test("親子ツリー構造が保持される", () => {
    const tickets = [
      makeTicket({ id: 1, subject: "Parent" }),
      makeTicket({ id: 2, subject: "Child", parentId: 1 }),
      makeTicket({ id: 3, subject: "Grandchild", parentId: 2 }),
    ];
    const nodes = buildTicketDashboardNodes(tickets);
    assert.strictEqual(nodes.length, 1, "ルートノードは1つ");
    assert.strictEqual(nodes[0].id, 1);
    assert.strictEqual(nodes[0].children.length, 1);
    assert.strictEqual(nodes[0].children[0].id, 2);
    assert.strictEqual(nodes[0].children[0].level, 1);
    assert.strictEqual(nodes[0].children[0].children[0].id, 3);
    assert.strictEqual(nodes[0].children[0].children[0].level, 2);
  });

  test("親が読み込まれていない子はルートに昇格する", () => {
    const tickets = [
      makeTicket({ id: 2, subject: "Child", parentId: 99 }),
    ];
    const nodes = buildTicketDashboardNodes(tickets);
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].id, 2);
    assert.strictEqual(nodes[0].level, 0);
  });

  test("各フィールドが正しくマッピングされる", () => {
    const tickets = [
      makeTicket({
        id: 10,
        subject: "Test",
        statusName: "In Progress",
        statusId: 2,
        priorityName: "High",
        priorityId: 3,
        trackerName: "Bug",
        trackerId: 1,
        assigneeName: "Alice",
        assigneeId: 42,
        dueDate: "2026-05-01",
      }),
    ];
    const node = buildTicketDashboardNodes(tickets)[0];
    assert.strictEqual(node.statusName, "In Progress");
    assert.strictEqual(node.statusId, 2);
    assert.strictEqual(node.priorityName, "High");
    assert.strictEqual(node.priorityId, 3);
    assert.strictEqual(node.trackerName, "Bug");
    assert.strictEqual(node.trackerId, 1);
    assert.strictEqual(node.assigneeName, "Alice");
    assert.strictEqual(node.assigneeId, 42);
    assert.strictEqual(node.dueDate, "2026-05-01");
  });

  test("buildTicketDetail でチケット詳細を変換する", () => {
    const ticket = makeTicket({
      id: 5,
      subject: "Detail test",
      description: "Some description",
      statusName: "Open",
      priorityName: "Normal",
    });
    const detail = buildTicketDetail(ticket);
    assert.strictEqual(detail.id, 5);
    assert.strictEqual(detail.subject, "Detail test");
    assert.strictEqual(detail.description, "Some description");
    assert.strictEqual(detail.statusName, "Open");
    assert.strictEqual(detail.priorityName, "Normal");
  });
});

suite("Dashboard ViewModel — 同期状態解決", () => {
  setup(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
    initializeDraftStoreForTests();
  });

  teardown(() => {
    clearOfflineSyncQueue();
    clearTicketDrafts();
  });

  test("ドラフトなし・キューなしは Synced を返す", () => {
    assert.strictEqual(resolveTicketSyncState(1), "Synced");
  });

  test("ドラフトが Dirty のとき Dirty を返す", () => {
    setupDraft(10, "Dirty");
    assert.strictEqual(resolveTicketSyncState(10), "Dirty");
  });

  test("ドラフトが Failed のとき Failed を返す", () => {
    setupDraft(11, "Failed");
    assert.strictEqual(resolveTicketSyncState(11), "Failed");
  });

  test("ドラフトが Conflict のとき Conflict を返す", () => {
    setupDraft(12, "Conflict");
    assert.strictEqual(resolveTicketSyncState(12), "Conflict");
  });

  test("ドラフトが Syncing のとき Syncing を返す", () => {
    setupDraft(13, "Syncing");
    assert.strictEqual(resolveTicketSyncState(13), "Syncing");
  });

  test("オフラインキューに積まれているとき Queued を返す", () => {
    replaceOfflineSyncQueue({
      tickets: new Map([[20, { ticketId: 20 } as never]]),
      comments: [],
      newTickets: [],
    });
    assert.strictEqual(resolveTicketSyncState(20), "Queued");
  });

  test("ドラフトが存在するときはキューより優先される", () => {
    setupDraft(21, "Failed");
    replaceOfflineSyncQueue({
      tickets: new Map([[21, { ticketId: 21 } as never]]),
      comments: [],
      newTickets: [],
    });
    assert.strictEqual(resolveTicketSyncState(21), "Failed");
  });

  test("buildTicketDashboardNodes で syncState がノードに反映される", () => {
    setupDraft(100, "Dirty");
    const tickets = [makeTicket({ id: 100 })];
    const nodes = buildTicketDashboardNodes(tickets);
    assert.strictEqual(nodes[0].syncState, "Dirty");
  });
});

suite("Dashboard ViewModel — 未同期アイテム変換", () => {
  setup(() => {
    clearOfflineSyncQueue();
  });

  teardown(() => {
    clearOfflineSyncQueue();
  });

  test("キューが空のとき空配列を返す", () => {
    const items = buildUnsyncedDashboardItems();
    assert.deepStrictEqual(items, []);
  });

  test("チケット更新が変換される", () => {
    replaceOfflineSyncQueue({
      tickets: new Map([[5, { ticketId: 5 } as never]]),
      comments: [],
      newTickets: [],
    });
    const items = buildUnsyncedDashboardItems();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].key.kind, "ticket");
    assert.strictEqual(items[0].key.ticketId, 5);
  });

  test("新規チケットが変換される", () => {
    replaceOfflineSyncQueue({
      tickets: new Map(),
      comments: [],
      newTickets: [{ documentUri: "file:///new.md", projectId: 1, content: "" }],
    });
    const items = buildUnsyncedDashboardItems();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].key.kind, "newTicket");
    assert.strictEqual(items[0].key.documentUri, "file:///new.md");
  });

  test("コメント更新が変換される", () => {
    replaceOfflineSyncQueue({
      tickets: new Map(),
      comments: [
        {
          ticketId: 7,
          commentId: 42,
          documentUri: "file:///comment.md",
          body: "test",
        },
      ],
      newTickets: [],
    });
    const items = buildUnsyncedDashboardItems();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].key.kind, "comment");
    assert.strictEqual(items[0].key.ticketId, 7);
    assert.strictEqual(items[0].key.commentId, 42);
  });

  test("複数種類の未同期アイテムを合算する", () => {
    replaceOfflineSyncQueue({
      tickets: new Map([[1, { ticketId: 1 } as never], [2, { ticketId: 2 } as never]]),
      comments: [{ ticketId: 3, commentId: 10, documentUri: "file:///c.md", body: "" }],
      newTickets: [{ documentUri: "file:///n.md", projectId: 2, content: "" }],
    });
    const items = buildUnsyncedDashboardItems();
    assert.strictEqual(items.length, 4);
  });
});

// ── テスト用ヘルパー ────────────────────────────────────────────────────────

function initializeDraftStoreForTests(): void {
  const { initializeDraftStore } = require("../views/ticketDraftStore");
  initializeDraftStore(createInMemoryDraftStorage());
}

function setupDraft(
  ticketId: number,
  status: import("../views/ticketSaveTypes").TicketDraftStatus,
): void {
  initializeTicketDraft(
    ticketId,
    "subject",
    "desc",
    {
      tracker: "Bug",
      priority: "Normal",
      status: "New",
      due_date: "",
    },
    "",
  );
  markDraftStatus(ticketId, status);
}
