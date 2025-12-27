import * as assert from "assert";
import { buildTicketPreviewContent } from "../views/ticketPreview";

suite("Ticket preview", () => {
  test("renders subject and description", () => {
    const content = buildTicketPreviewContent({
      subject: "Sample ticket",
      description: "Details",
      trackerName: "Task",
      priorityName: "Normal",
      statusName: "In Progress",
      dueDate: "2025-12-31",
    });

    assert.ok(content.includes("Sample ticket"));
    assert.ok(content.includes("Details"));
    assert.ok(content.includes("issue:"));
  });
});
