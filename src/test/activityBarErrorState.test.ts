import * as assert from "assert";
import { buildProjectsViewItems } from "../views/projectsView";
import { buildTicketsViewItems } from "../views/ticketsView";
import { buildCommentsViewItems } from "../views/commentsView";

suite("Activity Bar error states", () => {
  test("shows developer detail when list loading fails", () => {
    const projectError = "Failed to load projects: detail";
    const [projectItem] = buildProjectsViewItems([], undefined, projectError);
    assert.strictEqual(projectItem.label, projectError);

    const ticketError = "Failed to load tickets: detail";
    const [ticketItem] = buildTicketsViewItems([], 1, ticketError);
    assert.strictEqual(ticketItem.label, ticketError);

    const commentError = "Failed to load comments: detail";
    const [commentItem] = buildCommentsViewItems([], 1, commentError);
    assert.strictEqual(commentItem.label, commentError);
  });
});
