import * as assert from "assert";
import { confirmPendingChangeReview } from "../layers/extension-host/features/delete-redmine-items/pendingChangeReviewPresenter";
import type { PendingChangeReviewInput } from "../layers/extension-host/features/delete-redmine-items/deletionService";

suite("pending change review presenter", () => {
  const review = (overrides: Partial<PendingChangeReviewInput> = {}): PendingChangeReviewInput => ({
    title: "Delete ticket #1?",
    detail: "Child tickets may also be deleted.",
    items: [],
    unreadableReferences: [],
    blocked: false,
    ...overrides,
  });

  test("opening a pending change ends the confirmation and allows a new confirmation", async () => {
    let opened = 0;
    let rounds = 0;
    const input = review({
      items: [{ id: "draft", ticketIds: [2], label: "Draft #2", detail: "Ticket #2", version: "1", open: async () => { opened++; } }],
      unreadableReferences: ["#3"],
    });
    const dependencies = {
      pick: async (choices, options) => {
        assert.strictEqual(options.title, "Delete ticket #1?");
        assert.ok(choices.some(choice => choice.detail === "Child tickets may also be deleted."));
        assert.ok(choices.some(choice => choice.label.includes("#3")));
        rounds++;
        return rounds === 1 ? choices.find(choice => choice.action === "open") : choices.find(choice => choice.action === "delete");
      },
      showOpenError: async () => { throw new Error("unexpected open error"); },
    } satisfies NonNullable<Parameters<typeof confirmPendingChangeReview>[1]>;
    assert.strictEqual(await confirmPendingChangeReview(input, dependencies), false);
    assert.strictEqual(rounds, 1);
    assert.strictEqual(await confirmPendingChangeReview(input, dependencies), true);
    assert.strictEqual(opened, 1);
    assert.strictEqual(rounds, 2);
  });

  test("blocked and unavailable changes cannot be approved; closing cancels", async () => {
    for (const input of [review({ blocked: true }), review({ items: [{ id: "unavailable", ticketIds: [2], label: "Draft #2", detail: "Ticket #2", version: "1" }] })]) {
      const result = await confirmPendingChangeReview(input, {
        pick: async choices => {
          assert.ok(!choices.some(choice => choice.action === "delete"));
          return undefined;
        },
        showOpenError: async () => { throw new Error("unexpected open error"); },
      });
      assert.strictEqual(result, false);
    }
  });

  test("opens Unsynced and ends the confirmation even when deletion is blocked", async () => {
    let revealed = 0;
    const result = await confirmPendingChangeReview(review({
      blocked: true,
      openUnsynced: () => { revealed++; },
    }), {
      pick: async choices => choices.find(choice => choice.action === "unsynced"),
      showOpenError: async () => { throw new Error("unexpected open error"); },
    });
    assert.strictEqual(result, false);
    assert.strictEqual(revealed, 1);
  });

  test("an open failure ends the confirmation without waiting for the error notification", async () => {
    let rounds = 0;
    let errors = 0;
    const result = await confirmPendingChangeReview(review({
      items: [{ id: "draft", ticketIds: [2], label: "Draft #2", detail: "Ticket #2", version: "1", open: async () => { throw new Error("unavailable"); } }],
    }), {
      pick: async choices => { rounds++; return choices.find(choice => choice.action === "open"); },
      showOpenError: () => { errors++; return new Promise<unknown>(() => {}); },
    });
    assert.strictEqual(result, false);
    assert.strictEqual(rounds, 1);
    assert.strictEqual(errors, 1);
  });
});
