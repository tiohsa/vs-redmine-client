import * as assert from "assert";
import { buildProjectsViewItems } from "../views/projectsView";
import { buildTicketsViewItems } from "../views/ticketsView";
import { buildCommentsViewItems } from "../views/commentsView";

suite("Activity Bar empty states", () => {
  test("projects/tickets/comments provide distinct empty messages", () => {
    const [projectsItem] = buildProjectsViewItems([], undefined, undefined);
    assert.strictEqual(projectsItem.label, "No projects available.");

    const [ticketsItem] = buildTicketsViewItems([], undefined, undefined);
    assert.strictEqual(ticketsItem.label, "Select a project to view tickets.");

    const [commentsItem] = buildCommentsViewItems([], undefined, undefined);
    assert.strictEqual(commentsItem.label, "Select a ticket to view comments.");
  });
});
