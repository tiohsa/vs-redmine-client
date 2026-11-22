import * as assert from "assert";
import { runInNewContext } from "vm";
import { dashboardWebviewScript } from "../dashboard/dashboardWebviewScript";
import { resolveTicketSyncState } from "../dashboard/viewModels/ticketDashboardViewModel";
import { getCurrentConnectionScope } from "../config/connectionScope";
import {
  addOfflineTicketUpdateAsync, beginFreshTicketEdit, commitOfflineAbandonAsync,
  initializeOfflineSyncStore, prepareOfflineAbandon,
} from "../views/offlineSyncStore";
import {
  initializeDraftStore, initializeTicketDraft, markDraftStatus, updateDraftAfterSave,
} from "../views/ticketDraftStore";
import { createInMemoryDraftStorage } from "../views/draftPersistence";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const extract = (start: string, end: string): string => {
  const from = dashboardWebviewScript.indexOf(start);
  const to = dashboardWebviewScript.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return dashboardWebviewScript.slice(from, to);
};

interface UnsyncedElement {
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  onclick?: () => void;
  setAttribute: (name: string, value: string) => void;
  classList: { toggle: (name: string, force?: boolean) => void };
  querySelectorAll: (selector: string) => Array<{ addEventListener: (name: string, action: () => void) => void }>;
}

const renderUnsynced = (
  items: Array<{ lifecycle: string; requiresReview?: boolean; key: { kind: string; ticketId: number }; label: string }>,
  abandonedItems: Array<{ key: { kind: string; ticketId: number }; label: string; processingRecord?: string }> = [],
  toggleAbandoned = false,
) => {
  const elements: Record<string, UnsyncedElement> = {};
  for (const id of ["unsynced-badge", "unsynced-count-label", "sync-all-btn", "unsynced-summary", "unsynced-list", "abandoned-toggle", "abandoned-list", "forget-all-abandoned-btn"]) {
    const element: UnsyncedElement = {
      textContent: "",
      innerHTML: "",
      hidden: false,
      setAttribute: () => {},
      classList: { toggle: (name, force) => { if (name === "hidden") { element.hidden = force === true; } } },
      querySelectorAll: () => [],
    };
    elements[id] = element;
  }
  const unsyncedFunctions = extract("const UNSYNCED_BADGE_META=", "// ── Comments");
  runInNewContext(`${unsyncedFunctions}\nrenderUnsynced();${toggleAbandoned ? "document.getElementById('abandoned-toggle').onclick();" : ""}`, {
    state: { unsynced: { items, totalCount: items.length, abandonedItems } },
    document: { getElementById: (id: string) => elements[id] },
    STRINGS: {
      syncQueued: "Queued", syncReviewRequired: "Review Required", syncFailed: "Failed", syncConflict: "Conflict",
      unsyncedCountLabel: "{0} items", tabUnsynced: "Unsynced",
      unsyncedKindTicket: "Ticket", unsyncedKindNewTicket: "New ticket", unsyncedKindComment: "Comment",
      unsyncedKindFile: "File", resolveRecovery: "Resolve recovery", resolveRecoveryTooltip: "Resolve recovery",
      syncToRedmine: "Sync to Redmine", discardAction: "Discard", discardLaterChangesAction: "Discard later changes",
      discardLaterChangesTitle: "Discard later changes", discardTitle: "Discard",
      showAbandoned: "Show abandoned", hideAbandoned: "Hide abandoned", abandonedCount: "Abandoned: {0}",
      processingRecord: "Processing record", startNewTicketEdit: "Load latest and start new edit",
      deleteRetainedRecord: "Delete retained record",
    },
    esc: (value: unknown) => String(value ?? ""),
    safeJson: (value: unknown) => JSON.stringify(value),
    actionIcon: () => "",
    badge: (label: string, className: string) => `<span class="badge ${className}">${label}</span>`,
    unsyncedKindLabel: () => "Ticket",
    updateSyncButtonStates: () => {},
    req: () => {},
  });
  return {
    countLabelText: elements["unsynced-count-label"].textContent,
    cardHtml: elements["unsynced-list"].innerHTML,
    summaryHtml: elements["unsynced-summary"].innerHTML,
    syncAllHidden: elements["sync-all-btn"].hidden,
    abandonedHtml: elements["abandoned-list"].innerHTML,
    abandonedHidden: elements["abandoned-list"].hidden,
    abandonedToggleHidden: elements["abandoned-toggle"].hidden,
    abandonedToggleText: elements["abandoned-toggle"].textContent,
    forgetAllAbandonedHidden: elements["forget-all-abandoned-btn"].hidden,
  };
};

suite("Dashboard unsynced panel & sync state", () => {
  for (const status of ["Conflict", "Failed"] as const) {
    test(`${status} の中止後は Abandoned を優先し、新編集の ${status} は再表示する`, async () => {
      const scope = getCurrentConnectionScope();
      initializeOfflineSyncStore(createTestMemento(), scope);
      initializeDraftStore(createInMemoryDraftStorage(), scope);
      const metadata = buildIssueMetadataFixture();
      const update = {
        ticketId: 10, baseSubject: "Title", baseDescription: "Base", baseMetadata: metadata,
        subject: "Title", description: "Changed", metadata,
      };
      initializeTicketDraft(10, "Title", "Base", metadata, "t1", scope);
      await addOfflineTicketUpdateAsync(10, update, scope);
      markDraftStatus(10, status, scope);
      assert.strictEqual(resolveTicketSyncState(10), status);
      await commitOfflineAbandonAsync(prepareOfflineAbandon({ kind: "ticket", ticketId: 10 }, scope));
      assert.strictEqual(resolveTicketSyncState(10), "Abandoned");

      const authorization = await beginFreshTicketEdit(10, "file:///fresh-tray.md", scope);
      assert.ok(authorization);
      updateDraftAfterSave(10, "Title", "Base", metadata, "t2", scope);
      assert.strictEqual(resolveTicketSyncState(10), "Synced");
      markDraftStatus(10, status, scope);
      assert.strictEqual(resolveTicketSyncState(10), status);
      assert.strictEqual(await addOfflineTicketUpdateAsync(10, {
        ...update, documentUri: authorization.documentUri,
      }, scope, authorization.editSessionId), true);
      assert.strictEqual(resolveTicketSyncState(10), status);
      await commitOfflineAbandonAsync(prepareOfflineAbandon({ kind: "ticket", ticketId: 10 }, scope));
      assert.strictEqual(resolveTicketSyncState(10), "Abandoned");
    });
  }

  test("未同期0件では件数ラベルのみを表示し、空状態メッセージは出さない", () => {
    const result = renderUnsynced([]);
    assert.equal(result.countLabelText, "0 items");
    assert.equal(result.cardHtml, "");
    assert.equal(result.syncAllHidden, true);
  });

  test("中止済み0件では切替を隠す", () => {
    const result = renderUnsynced([]);
    assert.equal(result.abandonedToggleHidden, true);
    assert.equal(result.forgetAllAbandonedHidden, true);
    assert.equal(result.abandonedHtml, "");
  });

  test("中止済みのみを切り替えて処理記録と新規編集操作を表示する", () => {
    const abandoned = [{ key: { kind: "ticket", ticketId: 10 }, label: "Old ticket update", processingRecord: "old-operation" }];
    const closed = renderUnsynced([], abandoned);
    assert.equal(closed.abandonedToggleHidden, false);
    assert.equal(closed.forgetAllAbandonedHidden, false);
    assert.equal(closed.abandonedHidden, true);
    assert.ok(closed.abandonedToggleText.includes("Abandoned: 1"));
    const opened = renderUnsynced([], abandoned, true);
    assert.equal(opened.abandonedHidden, false);
    assert.equal(opened.forgetAllAbandonedHidden, false);
    assert.ok(opened.abandonedHtml.includes("old-operation"));
    assert.ok(opened.abandonedHtml.includes("Load latest and start new edit"));
    assert.ok(opened.abandonedHtml.includes("Delete retained record"));
  });

  test("通常項目と中止済み項目の混在時は通常項目だけを同期数に含める", () => {
    const result = renderUnsynced(
      [{ lifecycle: "queued", key: { kind: "ticket", ticketId: 11 }, label: "New update" }],
      [{ key: { kind: "ticket", ticketId: 10 }, label: "Old update" }],
      true,
    );
    assert.ok(result.cardHtml.includes("New update"));
    assert.ok(!result.cardHtml.includes("Old update"));
    assert.ok(result.abandonedHtml.includes("Old update"));
    assert.ok(result.summaryHtml.includes("Queued <strong>1</strong>"));
  });

  test("通常の queued item は queued 表示と Sync All を維持する", () => {
    const result = renderUnsynced([{ lifecycle: "queued", requiresReview: false, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" }]);
    assert.ok(result.cardHtml.includes('class="badge sync-queued">Queued</span>'));
    assert.ok(result.summaryHtml.includes('Queued <strong>1</strong>'));
    assert.ok(result.cardHtml.includes("Sync to Redmine"));
    assert.equal(result.syncAllHidden, false);
  });

  test("queued + requiresReview はカード・summary・bulk action の review 状態を共有する", () => {
    const result = renderUnsynced([{ lifecycle: "queued", requiresReview: true, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" }]);
    assert.ok(result.cardHtml.includes('class="badge sync-review">Review Required</span>'));
    assert.ok(result.summaryHtml.includes('Review Required <strong>1</strong>'));
    assert.ok(!result.summaryHtml.includes("Queued"));
    assert.ok(result.cardHtml.includes("Resolve recovery"));
    assert.ok(!result.cardHtml.includes("Sync to Redmine"));
    assert.equal(result.syncAllHidden, true);
  });

  test("recovery_pending と commit_unknown の既存 review 分類を保つ", () => {
    for (const lifecycle of ["recovery_pending", "commit_unknown"]) {
      const result = renderUnsynced([{ lifecycle, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" }]);
      assert.ok(result.cardHtml.includes('class="badge sync-review">Review Required</span>'));
      assert.ok(result.summaryHtml.includes('Review Required <strong>1</strong>'));
      assert.ok(result.cardHtml.includes("Resolve recovery"));
      assert.equal(result.syncAllHidden, true);
    }
  });

  test("mixed queue は各 summary を正しく分け、review があれば Sync All を隠す", () => {
    const result = renderUnsynced([
      { lifecycle: "queued", requiresReview: false, key: { kind: "ticket", ticketId: 10 }, label: "Ticket #10" },
      { lifecycle: "queued", requiresReview: true, key: { kind: "ticket", ticketId: 11 }, label: "Ticket #11" },
    ]);
    assert.ok(result.summaryHtml.includes('Queued <strong>1</strong>'));
    assert.ok(result.summaryHtml.includes('Review Required <strong>1</strong>'));
    assert.equal(result.syncAllHidden, true);
  });
});
