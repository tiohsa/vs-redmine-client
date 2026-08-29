import * as assert from "assert";
import { OutcomePresenter } from "../app/outcomePresenter";
import { SyncOutcome } from "../app/ticketSync/syncOperationTypes";

suite("RT-F: OutcomePresenter Single Notification Owner (outcomePresenterSingleOwner.test.ts)", () => {
  const makeNoopProvider = () => ({
    refresh: () => undefined,
    notifyChange: () => undefined,
    updateTicketSubject: () => undefined,
    refreshForTicket: () => undefined,
  });

  test("RT-F: conflict / commit_unknown / failed の各 Outcome で通知が重複して2重発火しないこと", () => {
    let notifyCallCount = 0;
    const notificationsStub: any = {
      notifyTicketSaveResult: () => {
        notifyCallCount++;
      },
      notifyCommentSaveResult: () => {
        notifyCallCount++;
      },
    };

    const presenter = new OutcomePresenter({
      ticketsPresentation: makeNoopProvider() as any,
      commentsPresentation: makeNoopProvider() as any,
      unsyncedPresentation: makeNoopProvider() as any,
      notifications: notificationsStub,
    });

    // 1. conflict
    notifyCallCount = 0;
    presenter.present({ kind: "conflict", ticketId: 101, message: "Conflict detected" });
    assert.strictEqual(notifyCallCount, 1, "conflict の通知は 1 回のみ");

    // 2. commit_unknown
    notifyCallCount = 0;
    presenter.present({ kind: "commit_unknown", operationId: "op-1", message: "Timeout" });
    assert.strictEqual(notifyCallCount, 1, "commit_unknown の通知は 1 回のみ");

    // 3. failed_before_commit
    notifyCallCount = 0;
    presenter.present({ kind: "failed_before_commit", error: new Error("Network error") });
    assert.strictEqual(notifyCallCount, 1, "failed_before_commit の通知は 1 回のみ");
  });
});
