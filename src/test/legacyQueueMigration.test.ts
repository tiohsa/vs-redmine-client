import * as assert from "assert";
import { initializeOfflineSyncStore } from "../views/offlineSyncStore";
import { createSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { createTestMemento } from "./helpers/vscodeMemento";
import type { CommentUpdateIntent, TicketCreateIntent, TicketUpdateIntent } from "../app/ticketSync/syncOperationTypes";

suite("RT-09: Legacy Queue Migration (legacyQueueMigration.test.ts)", () => {
  const scope = "https://legacy.example.org/";

  test("RT-09: 旧フォーマットで永続化されたキューがデータ損失なく復元され、新 UnifiedSyncOperation として扱えること", async () => {
    const memento = createTestMemento();
    // 旧バージョンの Memento 構造をシミュレート
    await memento.update("redmine.offlineSyncQueue", {
      tickets: [
        {
          ticketId: 201,
          subject: "Legacy Ticket Subject",
          description: "Legacy Ticket Desc",
          phase: "queued",
          revision: 1,
          connectionScope: scope,
        },
      ],
      newTickets: [
        {
          queueId: "legacy-new-1",
          content: "# New Ticket\n\nContent",
          projectId: 5,
          phase: "queued",
          revision: 1,
          connectionScope: scope,
        },
      ],
      comments: [
        {
          ticketId: 201,
          commentId: 301,
          body: "Legacy Comment Body",
          phase: "queued",
          revision: 1,
          connectionScope: scope,
        },
      ],
    });

    initializeOfflineSyncStore(memento, scope);
    const repo = createSyncOperationRepository();

    // 1. Ticket の復元
    const ticketOp = repo.getOperation({ kind: "ticket", ticketId: 201 }, scope);
    assert.ok(ticketOp, "旧チケットが UnifiedSyncOperation として取得できること");
    assert.strictEqual(ticketOp.kind, "ticket_update");
    assert.strictEqual((ticketOp.intent as TicketUpdateIntent)?.subject, "Legacy Ticket Subject");
    assert.strictEqual(ticketOp.connectionScope, scope);

    // 2. NewTicket の復元
    const newTicketOp = repo.getOperation({ kind: "newTicket", queueId: "legacy-new-1" }, scope);
    assert.ok(newTicketOp, "旧新規チケットが UnifiedSyncOperation として取得できること");
    assert.strictEqual(newTicketOp.kind, "ticket_create");
    assert.strictEqual(newTicketOp.projectId, 5);

    // 3. Comment の復元
    const commentOp = repo.getOperation({ kind: "comment", ticketId: 201, commentId: 301 }, scope);
    assert.ok(commentOp, "旧コメントが UnifiedSyncOperation として取得できること");
    assert.strictEqual(commentOp.kind, "comment_update");
    assert.strictEqual((commentOp.intent as CommentUpdateIntent)?.body, "Legacy Comment Body");
  });
});
