import * as assert from "assert";
import {
  evaluateAttemptClosure,
  type DurableSyncEffect,
  type TicketCreateRequestSnapshot,
} from "../app/syncEffects";

suite("Attempt Closure coverage performance", () => {
  test("多数 uploads と attachment の membership 判定は線形で、Array.some に依存しない", () => {
    const uploadCount = 4096;
    const uploads = Array.from({ length: uploadCount }, (_, index) => ({
      token: `upload-token-${index}`,
      filename: `file-${index}.bin`,
      content_type: "application/octet-stream",
    }));

    // 旧実装の配列走査へ戻ると、この sentinel が検知する。
    uploads.some = () => {
      throw new Error("Primary uploads membership must not use Array.some");
    };

    const primary: DurableSyncEffect = {
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "compensated",
      target: {},
      requestSnapshot: {
        kind: "ticket_create",
        request: {
          projectId: 1,
          subject: "Parent",
          description: "Description",
          uploads,
        },
      } satisfies TicketCreateRequestSnapshot,
    };
    const attachments: DurableSyncEffect[] = uploads.map((upload, index) => ({
      effectId: `attachment:file:${index}`,
      kind: "attachment_upload",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      token: upload.token,
      target: { token: upload.token, ordinal: index },
    }));

    const decision = evaluateAttemptClosure({
      revision: 1,
      attemptGeneration: 1,
      effects: [primary, ...attachments],
    });

    assert.strictEqual(decision.closable, true);
    assert.strictEqual(decision.classifications.length, uploadCount + 1);
    assert.strictEqual(decision.coveredEffects.length, uploadCount);
    assert.strictEqual(decision.blockers.length, 0);
  });

  test("大量 coverage の中の未登録 token は正しく blocker になる", () => {
    const uploadCount = 2048;
    const uploads = Array.from({ length: uploadCount }, (_, index) => ({
      token: `registered-token-${index}`,
      filename: `file-${index}.bin`,
      content_type: "application/octet-stream",
    }));
    const primary: DurableSyncEffect = {
      effectId: "ticket-create",
      kind: "ticket_create",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "compensated",
      target: {},
      requestSnapshot: {
        kind: "ticket_create",
        request: {
          projectId: 1,
          subject: "Parent",
          description: "Description",
          uploads,
        },
      } satisfies TicketCreateRequestSnapshot,
    };
    const attachments: DurableSyncEffect[] = uploads.map((upload, index) => ({
      effectId: `attachment:file:${index}`,
      kind: "attachment_upload",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      token: upload.token,
      target: { token: upload.token, ordinal: index },
    }));
    attachments.push({
      effectId: "attachment:file:unregistered",
      kind: "attachment_upload",
      operationRevision: 1,
      attemptGeneration: 1,
      state: "committed",
      token: "unregistered-token",
      target: { token: "unregistered-token", ordinal: uploadCount },
    });

    const decision = evaluateAttemptClosure({
      revision: 1,
      attemptGeneration: 1,
      effects: [primary, ...attachments],
    });

    assert.strictEqual(decision.closable, false);
    assert.strictEqual(decision.coveredEffects.length, uploadCount);
    assert.deepStrictEqual(decision.blockers.map((blocker) => blocker.effectId), [
      "attachment:file:unregistered",
    ]);
    assert.strictEqual(decision.blockers[0]?.reason, "COVERAGE_MISSING");
  });
});
