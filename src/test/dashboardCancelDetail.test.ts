import * as assert from "assert";
import { DashboardController } from "../dashboard/DashboardController";
import { DashboardStateStore } from "../dashboard/DashboardStateStore";
import type { DashboardCommentItem, DashboardTicketDetail } from "../dashboard/dashboardProtocol";

const makeController = (store: DashboardStateStore): DashboardController => new DashboardController({
  store,
  notifyOperationStarted: () => {},
  notifySuccess: () => {},
  notifyError: () => {},
  notifyToast: () => {},
  onTicketsRefreshed: () => {},
});

const makeDetail = (id: number): DashboardTicketDetail => ({
  id,
  subject: `Ticket #${id}`,
  syncState: "Synced",
});

const makeComment = (): DashboardCommentItem => ({
  id: 1,
  authorName: "Alice",
  body: "Comment",
  editableByCurrentUser: false,
  hasUnsyncedEdit: false,
});

suite("DashboardController ticket.cancelDetail", () => {
  test("選択中チケット詳細とコメント表示状態を解除する", async () => {
    const store = new DashboardStateStore();
    store.update({
      selectedTicketId: 42,
      selectedTicket: makeDetail(42),
      workPanel: { mode: "detail", ticketId: 42 },
      comments: {
        ticketId: 42,
        loading: true,
        items: [makeComment()],
        error: "failed",
      },
    });

    const controller = makeController(store);
    await controller.handle({ type: "ticket.cancelDetail", requestId: "r" });

    const state = store.getState();
    assert.strictEqual(state.selectedTicketId, undefined);
    assert.strictEqual(state.selectedTicket, undefined);
    assert.strictEqual(state.workPanel, undefined);
    assert.strictEqual(state.comments.ticketId, undefined);
    assert.strictEqual(state.comments.loading, false);
    assert.deepStrictEqual(state.comments.items, []);
    assert.strictEqual(state.comments.error, undefined);
  });
});
