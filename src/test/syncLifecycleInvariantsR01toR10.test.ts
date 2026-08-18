import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  initializeOfflineSyncStore,
  addOfflineTicketUpdate,
  addOfflineNewTicketAsync,
  addOfflineCommentUpdate,
  getOfflineSyncQueue,
} from "../views/offlineSyncStore";
import { createSyncEngine } from "../app/syncEngine";
import { createTestMemento } from "./helpers/vscodeMemento";
import { createSyncOperationRepository, DefaultSyncOperationRepository } from "../app/ticketSync/syncRepository";
import { createSyncCoordinator } from "../app/ticketSync/syncCoordinator";
import { buildCommentUpdateFileContent } from "../views/commentUpdateFile";
import type { SyncOutcome } from "../app/ticketSync/syncOperationTypes";

const SCOPE = "https://redmine.example.org/r01-r10-suite";

suite("R01 〜 R10: Invariant & Lifecycle Recovery Tests", () => {
  let memento: vscode.Memento;

  setup(() => {
    memento = createTestMemento();
    initializeOfflineSyncStore(memento, SCOPE);
  });

  // R01: Comment local image E2E (INV-03, Actual Request Snapshot)
  test("R01: local Markdown image を含む Comment が actual submitted body で reconcile され completed になる (INV-03)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r01-test-"));
    const imgPath = path.join(tmpDir, "screen.png");
    fs.writeFileSync(imgPath, "fake png content");

    const commentFile = path.join(tmpDir, "new_comment.md");
    const rawBody = `Review notes with image: ![screenshot](${imgPath})`;
    fs.writeFileSync(commentFile, rawBody);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(commentFile));

    addOfflineCommentUpdate({
      ticketId: 101,
      body: rawBody,
      baseDir: tmpDir,
      documentUri: doc.uri.toString(),
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let uploadedToken = "";
    let submittedNotes = "";
    let addCommentCalls = 0;

    const engine = createSyncEngine({
      comments: {
        getCurrentUserId: async () => 42,
        uploadFile: async () => {
          uploadedToken = "token-xyz-123";
          return { token: uploadedToken, filename: "screen.png", contentType: "image/png" };
        },
        addComment: async (_ticketId, notes, uploads) => {
          addCommentCalls++;
          submittedNotes = notes;
          assert.ok(!notes.includes(imgPath), "Submitted notes should have replaced the local file path");
          assert.ok(notes.includes("screen.png"), "Submitted notes should contain the uploaded filename");
          assert.strictEqual(uploads?.length, 1);
        },
        getIssueDetail: async (ticketId) => ({
          ticket: { id: ticketId, projectId: 1, updatedAt: "2026-08-16T00:00:00Z" } as any,
          comments: [
            // Remote has the submittedNotes (with replaced image filename)
            { id: 501, ticketId, body: submittedNotes, authorId: 42, user: { id: 42, name: "Author" } } as any,
          ],
        }),
      },
    });

    const outcome = await engine.syncOne(
      { kind: "comment", ticketId: 101, documentUri: doc.uri.toString() },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(addCommentCalls, 1, "addComment が1回呼ばれること");
    assert.strictEqual(outcome.kind, "completed", "Reconciliation with actual submitted body succeeds");
    assert.strictEqual((outcome as any).commentId, 501, "Resolved comment ID is 501");
  });

  // R02: Preflight validation on TicketUpdate (INV-08)
  test("R02: child ticket を持つ TicketUpdate で projectId が解決できない場合、Primary PUT を呼ばずに failed_before_commit となる (INV-08)", async () => {
    addOfflineTicketUpdate(202, {
      ticketId: 202,
      baseSubject: "Parent Issue",
      baseDescription: "Desc",
      baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
      subject: "Parent Issue Updated",
      description: "Desc Updated",
      metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child Subtask 1"] },
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let updateIssueCalls = 0;
    let createIssueCalls = 0;

    const engine = createSyncEngine({
      tickets: {
        getIssueDetail: async () => {
          throw new Error("404 Not Found (or network failure when discovering projectId)");
        },
        updateIssue: async () => {
          updateIssueCalls++;
        },
        createIssue: async () => {
          createIssueCalls++;
          return 999;
        },
      },
    });

    const outcome = await engine.syncOne(
      { kind: "ticket", ticketId: 202 },
      { connectionScope: SCOPE },
    );

    assert.strictEqual(updateIssueCalls, 0, "Primary PUT (updateIssue) は一度も呼ばれてはならない (INV-08)");
    assert.strictEqual(createIssueCalls, 0, "Child createIssue は呼ばれてはならない");
    assert.strictEqual(outcome.kind, "failed_before_commit");
  });

  // R03: Effect Evidence Preservation (INV-04)
  test("R03: Image A commit 後 Image B 失敗時、次回 sync で Image A を再アップロードしない (INV-04)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r03-test-"));
    const imgA = path.join(tmpDir, "a.png");
    const imgB = path.join(tmpDir, "b.png");
    fs.writeFileSync(imgA, "data A");
    fs.writeFileSync(imgB, "data B");

    const rawBody = `Images: ![A](${imgA}) and ![B](${imgB})`;

    addOfflineCommentUpdate({
      ticketId: 303,
      body: rawBody,
      baseDir: tmpDir,
      phase: "queued",
      revision: 1,
    }, SCOPE);

    let uploadACalls = 0;
    let uploadBCalls = 0;
    let failB = true;

    const engine = createSyncEngine({
      comments: {
        uploadFile: async (filePath: string) => {
          if (filePath.includes("a.png")) {
            uploadACalls++;
            return { token: "token-A", filename: "a.png", contentType: "image/png" };
          }
          uploadBCalls++;
          if (failB) {
            throw new Error("400 Bad Request for B");
          }
          return { token: "token-B", filename: "b.png", contentType: "image/png" };
        },
        addComment: async () => {},
        getIssueDetail: async (id) => ({ ticket: { id, projectId: 1 } as any, comments: [] }),
      },
    });

    // 1st sync: A succeeds, B fails (known 400 failure -> failed_before_commit)
    const outcome1 = await engine.syncOne({ kind: "comment", ticketId: 303 }, { connectionScope: SCOPE });
    assert.strictEqual(outcome1.kind, "failed_before_commit");
    assert.strictEqual(uploadACalls, 1);
    assert.strictEqual(uploadBCalls, 1);

    // 2nd sync: B fails again
    const outcome2 = await engine.syncOne({ kind: "comment", ticketId: 303 }, { connectionScope: SCOPE });
    assert.strictEqual(outcome2.kind, "failed_before_commit");
    assert.strictEqual(uploadACalls, 1, "Image A must not be re-uploaded (INV-04)");
    assert.strictEqual(uploadBCalls, 1, "Image B is not retried automatically on non_retriable failure (R-04, INV-04)");
  });

  // R04 / T-33: Compensation Crash (INV-07, INV-N12)
  test("R04: complete_compensation persistence 失敗後は compensation_unknown となり自動再CREATE・再DELETE しない (INV-07, INV-N12)", async () => {
    const parentTicketId = 4040;
    const key = { kind: "newTicket" as const, queueId: "r04-queue" };

    let completeCompCalls = 0;
    class FlakyCompensationRepo extends DefaultSyncOperationRepository {
      public override async transitionEffect(k: any, effectId: string, action: any, scope: string, expected?: any) {
        if (effectId === "ticket-create" && action.kind === "complete_compensation") {
          completeCompCalls++;
          return undefined; // persistence failure!
        }
        return super.transitionEffect(k, effectId, action, scope, expected);
      }
    }

    const repo = new FlakyCompensationRepo();
    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:r04-queue`,
      kind: "ticket_create",
      key,
      connectionScope: SCOPE,
      phase: "queued",
      revision: 1,
      persistenceVersion: 1,
      intent: {
        projectId: 1,
        subject: "Parent Issue R04",
        description: "",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child Fail"] },
      } as any,
    }, SCOPE);

    let createIssueCalls = 0;
    let deleteIssueCalls = 0;

    const coordinator = createSyncCoordinator({ repository: repo });
    const engine = createSyncEngine({
      coordinator,
      tickets: {
        createIssue: async (input: any) => {
          createIssueCalls++;
          if (input.parentId) {
            throw new Error("400 Bad Request: Child creation validation failure");
          }
          return parentTicketId;
        },
        deleteIssue: async (id: number) => {
          deleteIssueCalls++;
          assert.strictEqual(id, parentTicketId);
        },
        getIssueDetail: async (id: number) => ({
          ticket: { id, projectId: 1, subject: "Parent Issue R04", description: "", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-16T00:00:00Z" } as any,
          comments: [],
        }),
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    // 1st sync: parent create → child fail → start_compensation → DELETE success → complete_compensation persistence failure
    const outcome1 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.notStrictEqual(outcome1.kind, "completed");
    assert.strictEqual(completeCompCalls, 1, "complete_compensation transition was attempted");
    assert.strictEqual(deleteIssueCalls, 1, "Parent ticket DELETE was executed");

    // 2nd sync: restart / retry from compensation_unknown
    const outcome2 = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.notStrictEqual(outcome2.kind, "completed");
    assert.strictEqual(createIssueCalls, 2, "1 parent create + 1 child create attempt in 1st sync, 0 additional in 2nd sync");
    assert.strictEqual(deleteIssueCalls, 1, "No additional DELETE execution in 2nd sync");
  });

  // R05: Compensation Recovery (INV-06)
  test("R05: compensation_unknown から resolveEffect で Remote absent を確認して clean に遷移できる (INV-06)", async () => {
    const key = { kind: "newTicket" as const, queueId: "r05-queue" };
    const repo = createSyncOperationRepository();

    await repo.saveOperation({
      operationId: `${SCOPE}:newTicket:r05-queue`,
      kind: "ticket_create",
      key,
      connectionScope: SCOPE,
      phase: "commit_unknown",
      revision: 1,
      persistenceVersion: 1,
      createdRemoteId: 5050,
      effects: [
        {
          effectId: "ticket-create",
          kind: "ticket_create",
          operationRevision: 1,
          state: "compensation_unknown",
          target: { ticketId: 5050 },
          remoteId: 5050,
        },
      ],
      intent: {
        projectId: 1,
        subject: "R05 Ticket",
        description: "",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "" },
      } as any,
    }, SCOPE);

    const coordinator = createSyncCoordinator({ repository: repo });
    let deleteCalls = 0;

    const outcome = await coordinator.resolveEffect({
      key,
      operationId: `${SCOPE}:newTicket:r05-queue`,
      operationRevision: 1,
      effectId: "ticket-create",
      expectedEffectState: "compensation_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "retry_effect" },
      deps: {
        ticketCreate: {
          getIssueDetail: async () => {
            const err: any = new Error("404 Not Found");
            err.status = 404;
            throw err;
          },
          deleteIssue: async () => {
            deleteCalls++;
          },
        } as any,
      },
    });

    assert.strictEqual(deleteCalls, 0, "Already deleted on remote, deleteIssue not needed");
    assert.strictEqual(outcome.kind, "no_change", "Successfully resolved compensation to clean state");

    const opAfter = repo.getOperation(key, SCOPE);
    const primaryEffect = opAfter?.effects?.find((e) => e.effectId === "ticket-create");
    assert.strictEqual(primaryEffect?.state, "compensated");
  });

  // R06: Upload Recovery (INV-05, INV-06)
  test("R06: commit_unknown upload は normal sync で retry せず、resolveEffect で明示的 retry / token 保持できる (INV-05, INV-06)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r06-test-"));
    const imgPath = path.join(tmpDir, "upload_r06.png");
    fs.writeFileSync(imgPath, "data");

    const key = { kind: "comment" as const, ticketId: 606 };
    const repo = createSyncOperationRepository();

    const effectId = `image_upload:${imgPath}`;
    await repo.saveOperation({
      operationId: `${SCOPE}:comment:606`,
      kind: "comment_create",
      key,
      connectionScope: SCOPE,
      phase: "commit_unknown",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 606,
      effects: [
        {
          effectId,
          kind: "image_upload",
          operationRevision: 1,
          state: "commit_unknown",
          target: { filePath: imgPath, filename: "upload_r06.png" },
        },
      ],
      intent: {
        ticketId: 606,
        body: `Comment with ![img](${imgPath})`,
        baseDir: tmpDir,
      },
    }, SCOPE);

    let uploadCalls = 0;
    const coordinator = createSyncCoordinator({ repository: repo });

    // 1. Normal sync: must NOT automatically retry upload (INV-05)
    const normalOutcome = await coordinator.sync(key, { connectionScope: SCOPE });
    assert.strictEqual(uploadCalls, 0, "Normal sync must not automatically retry commit_unknown upload");
    assert.strictEqual(normalOutcome.kind, "commit_unknown");

    // 2. Explicit assume_committed with token: token must be preserved
    const assumeOutcome = await coordinator.resolveEffect({
      key,
      operationId: `${SCOPE}:comment:606`,
      operationRevision: 1,
      effectId,
      expectedEffectState: "commit_unknown",
      context: { connectionScope: SCOPE },
      resolution: { kind: "assume_committed", token: "token-already-committed" },
    });
    void assumeOutcome;

    const opAfterAssume = repo.getOperation(key, SCOPE);
    const effectAfterAssume = opAfterAssume?.effects?.find((e) => e.effectId === effectId);
    assert.strictEqual(effectAfterAssume?.state, "committed");
    assert.strictEqual(effectAfterAssume?.token, "token-already-committed", "Token must be preserved during assume_committed");
  });

  // R07: Child Recovery (INV-05)
  test("R07: child unknown は normal sync で blind retry されない (INV-05)", async () => {
    const key = { kind: "ticket" as const, ticketId: 707 };
    const repo = createSyncOperationRepository();

    await repo.saveOperation({
      operationId: `${SCOPE}:ticket:707`,
      kind: "ticket_update",
      key,
      connectionScope: SCOPE,
      phase: "remote_committed",
      revision: 1,
      persistenceVersion: 1,
      ticketId: 707,
      effects: [
        {
          effectId: "ticket-update",
          kind: "ticket_update",
          operationRevision: 1,
          state: "committed",
          target: { ticketId: 707 },
        },
        {
          effectId: "child-create:0",
          kind: "child_create",
          operationRevision: 1,
          state: "commit_unknown",
          target: { parentTicketId: 707, ordinal: 0 },
        },
      ],
      intent: {
        ticketId: 707,
        baseSubject: "S",
        baseDescription: "D",
        baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        subject: "S",
        description: "D",
        metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: ["Child 1"] },
      },
    }, SCOPE);

    let createIssueCalls = 0;
    const coordinator = createSyncCoordinator({ repository: repo });
    const engine = createSyncEngine({
      coordinator,
      tickets: {
        createIssue: async () => {
          createIssueCalls++;
          return 708;
        },
      },
    });

    const outcome = await engine.syncOne(key, { connectionScope: SCOPE });
    assert.strictEqual(createIssueCalls, 0, "child unknown は normal sync で blind retry されない (INV-05)");
    assert.strictEqual(outcome.kind, "remote_committed");
  });

  // R08: Sync All Cancel (INV-13, INV-14)
  test("R08: Sync All で 10件中3件後 cancel: results=3, remaining=7, stopReason=user_cancelled (INV-13, INV-14)", async () => {
    const repo = createSyncOperationRepository();
    for (let i = 1; i <= 10; i++) {
      await repo.saveOperation({
        operationId: `${SCOPE}:ticket:${i}`,
        kind: "ticket_update",
        key: { kind: "ticket", ticketId: i },
        connectionScope: SCOPE,
        phase: "queued",
        revision: 1,
        persistenceVersion: 1,
        ticketId: i,
        intent: {
          ticketId: i,
          baseSubject: `T${i}`,
          baseDescription: "",
          baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
          subject: `T${i} updated`,
          description: "",
          metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        },
      }, SCOPE);
    }

    let processedCount = 0;
    const coordinator = createSyncCoordinator({ repository: repo });
    const engine = createSyncEngine({
      coordinator,
      tickets: {
        updateIssue: async () => {
          processedCount++;
        },
        getIssueDetail: async (id) => ({
          ticket: { id, projectId: 1, subject: `T${id} updated`, description: "", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-16T00:00:00Z" } as any,
          comments: [],
        }),
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    let cancellationRequested = false;
    const outcome = await engine.syncAll(
      { connectionScope: SCOPE },
      {
        shouldContinue: () => {
          if (processedCount >= 3) {
            cancellationRequested = true;
            return false;
          }
          return true;
        },
      },
    );

    assert.strictEqual(outcome.results.length, 3, "Exactly 3 operations processed");
    assert.strictEqual(outcome.remaining.length, 7, "Exactly 7 operations remaining");
    assert.strictEqual(outcome.cancelled, true, "cancelled flag is true");
    assert.strictEqual(outcome.stopReason, "user_cancelled", "stopReason is user_cancelled");
    assert.strictEqual(processedCount, 3, "No subsequent remote mutations started after cancellation");
  });

  // R09: Recovery Stop (INV-14)
  test("R09: Sync All で 3件目 commit_unknown 時: stopReason=blocked_by_recovery で user_cancelled ではない (INV-14)", async () => {
    const repo = createSyncOperationRepository();
    for (let i = 1; i <= 5; i++) {
      await repo.saveOperation({
        operationId: `${SCOPE}:ticket:${i}`,
        kind: "ticket_update",
        key: { kind: "ticket", ticketId: i },
        connectionScope: SCOPE,
        phase: "queued",
        revision: 1,
        persistenceVersion: 1,
        ticketId: i,
        intent: {
          ticketId: i,
          baseSubject: `T${i}`,
          baseDescription: "",
          baseMetadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
          subject: `T${i} updated`,
          description: "",
          metadata: { tracker: "Bug", priority: "Normal", status: "New", due_date: "", children: [] },
        },
      }, SCOPE);
    }

    let processedCount = 0;
    const coordinator = createSyncCoordinator({ repository: repo });
    const engine = createSyncEngine({
      coordinator,
      tickets: {
        updateIssue: async (input: any) => {
          processedCount++;
          if (input.issueId === 3 || input.ticketId === 3) {
            const err: any = new Error("ETIMEDOUT");
            err.code = "ETIMEDOUT";
            throw err;
          }
        },
        getIssueDetail: async (id) => ({
          ticket: { id, projectId: 1, subject: `T${id} updated`, description: "", trackerId: 1, trackerName: "Bug", priorityId: 1, priorityName: "Normal", statusId: 1, statusName: "New", updatedAt: "2026-08-16T00:00:00Z" } as any,
          comments: [],
        }),
        getProjectTrackers: async () => [{ id: 1, name: "Bug" }],
        listIssueStatuses: async () => [{ id: 1, name: "New" }],
        listIssuePriorities: async () => [{ id: 1, name: "Normal" }],
      },
    });

    const outcome = await engine.syncAll({ connectionScope: SCOPE });

    assert.strictEqual(outcome.results.length, 3, "3 operations attempted");
    assert.strictEqual(outcome.results[2].outcome.kind, "commit_unknown");
    assert.strictEqual(outcome.remaining.length, 2, "2 operations remaining");
    assert.strictEqual(outcome.cancelled, false, "Not a user cancellation");
    assert.strictEqual(outcome.stopReason, "blocked_by_recovery", "stopReason is blocked_by_recovery");
    assert.strictEqual(processedCount, 3, "4th and 5th operations were halted");
  });

  // R10: Ownership static check (INV-12)
  test("R10: Production code (src/ excluding src/test/) に legacy direct lifecycle mutation が存在しないこと (INV-12)", () => {
    const srcDir = path.resolve(__dirname, "../..");
    const forbiddenPatterns = [
      "transitionOfflineNewTicketLifecycleAsync",
      "transitionOfflineTicketUpdateLifecycleAsync",
    ];

    const checkDir = (dir: string): string[] => {
      const violations: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "test" && entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== "out") {
            violations.push(...checkDir(fullPath));
          }
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          // offlineSyncStore.ts defines the functions, so exclude its own declaration
          if (entry.name === "offlineSyncStore.ts") {
            continue;
          }
          const content = fs.readFileSync(fullPath, "utf8");
          for (const pattern of forbiddenPatterns) {
            if (content.includes(pattern)) {
              violations.push(`${fullPath} contains legacy lifecycle call: ${pattern}`);
            }
          }
        }
      }
      return violations;
    };

    const violations = checkDir(srcDir);
    assert.deepStrictEqual(violations, [], `Forbidden legacy lifecycle calls found: ${violations.join(", ")}`);
  });
});
