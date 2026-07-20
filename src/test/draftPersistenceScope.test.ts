import * as assert from "assert";
import { createGlobalStateDraftStorage } from "../views/draftPersistence";
import type { TicketDraftState } from "../views/ticketSaveTypes";
import { createTestMemento } from "./helpers/vscodeMemento";
import { buildIssueMetadataFixture } from "./helpers/ticketMetadataFixtures";

const draft = (ticketId: number): TicketDraftState => ({
  ticketId,
  baseSubject: `Ticket ${ticketId}`,
  baseDescription: "",
  baseMetadata: buildIssueMetadataFixture(),
  status: "Dirty",
});

suite("Ticket draft connection scope", () => {
  test("baseUrl変更では他接続先のドラフトを読み込まず、切り戻し後に復元する", () => {
    const memento = createTestMemento();
    const oldStorage = createGlobalStateDraftStorage(
      memento as unknown as import("vscode").Memento,
      "https://old.example/redmine",
    );
    oldStorage.save(1, draft(1));

    const newStorage = createGlobalStateDraftStorage(
      memento as unknown as import("vscode").Memento,
      "https://new.example/redmine",
    );
    assert.strictEqual(newStorage.loadAll().size, 0);
    newStorage.save(2, draft(2));

    assert.deepStrictEqual(Array.from(oldStorage.loadAll().keys()), [1]);
    assert.deepStrictEqual(Array.from(newStorage.loadAll().keys()), [2]);
  });

  test("旧形式ドラフトは現在のbaseUrlへ移行して再起動後も保持する", () => {
    const memento = createTestMemento();
    const legacy = createGlobalStateDraftStorage(
      memento as unknown as import("vscode").Memento,
    );
    legacy.save(7, draft(7));

    const migrated = createGlobalStateDraftStorage(
      memento as unknown as import("vscode").Memento,
      "https://current.example/redmine",
    );
    assert.deepStrictEqual(Array.from(migrated.loadAll().keys()), [7]);
  });
});
