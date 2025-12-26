import * as assert from "assert";
import { buildTicketPreviewContent } from "../views/ticketPreview";

suite("Ticket preview", () => {
  test("renders subject and description", () => {
    const content = buildTicketPreviewContent({
      subject: "Sample ticket",
      description: "Details",
    });

    assert.ok(content.includes("Sample ticket"));
    assert.ok(content.includes("Details"));
  });
});
