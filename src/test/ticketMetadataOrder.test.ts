import * as assert from "assert";
import { parseIssueMetadataYaml, serializeIssueMetadataYaml } from "../views/ticketMetadataYaml";
import { IssueMetadata } from "../views/ticketMetadataTypes";

suite("Ticket metadata order", () => {
    test("preserves key order from parsed YAML", () => {
        const yaml = [
            "issue:",
            "  start_date: 2025-01-01", // Custom order: start_date first
            "  tracker: Task",
            "  priority: Normal",
            "  status: New",
            "  due_date: 2025-12-31",
            "  estimated_hours: 8",
        ].join("\n");

        const parsed = parseIssueMetadataYaml(yaml);
        const serialized = serializeIssueMetadataYaml(parsed);

        // Verify start_date is before tracker in serialized output
        const lines = serialized.split("\n");
        const startDateIndex = lines.findIndex(l => l.includes("start_date"));
        const trackerIndex = lines.findIndex(l => l.includes("tracker"));

        assert.ok(startDateIndex !== -1, "start_date should be present");
        assert.ok(trackerIndex !== -1, "tracker should be present");
        assert.ok(startDateIndex < trackerIndex, "start_date should appear before tracker");
    });

    test("uses default order when keyOrder is missing", () => {
        const metadata: IssueMetadata = {
            tracker: "Task",
            priority: "Normal",
            status: "New",
            due_date: "2025-12-31",
            estimated_hours: 8,
            keyOrder: undefined, // Explicitly undefined
        };

        const serialized = serializeIssueMetadataYaml(metadata);
        const lines = serialized.split("\n");

        // Default order: tracker, priority, status, due_date...
        const trackerIndex = lines.findIndex(l => l.includes("tracker"));
        const priorityIndex = lines.findIndex(l => l.includes("priority"));

        assert.ok(trackerIndex < priorityIndex, "tracker should appear before priority in default order");
    });
});
