import * as assert from "assert";
import { buildNewTicketDraftUri } from "../commands/createTicketFromList";

suite("New ticket draft uri", () => {
  test("builds untitled uri in workspace", () => {
    const uri = buildNewTicketDraftUri("/workspace", () => false);

    assert.strictEqual(uri.toString(), "untitled:/workspace/todoex-new-ticket.md");
  });

  test("adds suffix when filename already exists", () => {
    const uri = buildNewTicketDraftUri(
      "/workspace",
      (candidate) => candidate === "/workspace/todoex-new-ticket.md",
    );

    assert.strictEqual(uri.toString(), "untitled:/workspace/todoex-new-ticket-1.md");
  });
});
