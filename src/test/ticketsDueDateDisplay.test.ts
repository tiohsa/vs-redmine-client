import * as assert from "assert";
import {
  formatDueDateIndicator,
  resolveDueDateWindow,
  DueDateDisplayRule,
} from "../views/projectListSettings";

const baseRule: DueDateDisplayRule = {
  showWithin7Days: true,
  showWithin3Days: true,
  showWithin1Day: true,
  showOverdue: true,
};

suite("Ticket due date display", () => {
  test("selects closest due date window", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const ticket = {
      id: 1,
      subject: "Soon",
      projectId: 1,
      dueDate: "2025-01-11",
    };

    const window = resolveDueDateWindow(ticket, baseRule, now);
    const label = formatDueDateIndicator(window);

    assert.strictEqual(window, "within1Day");
    assert.strictEqual(label, "Due in 1 day");
  });

  test("respects disabled windows", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const ticket = {
      id: 2,
      subject: "Soon",
      projectId: 1,
      dueDate: "2025-01-11",
    };

    const rule: DueDateDisplayRule = {
      ...baseRule,
      showWithin1Day: false,
      showWithin3Days: true,
    };

    const window = resolveDueDateWindow(ticket, rule, now);
    const label = formatDueDateIndicator(window);

    assert.strictEqual(window, "within3Days");
    assert.strictEqual(label, "Due in 3 days");
  });

  test("uses overdue when date has passed", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const ticket = {
      id: 3,
      subject: "Late",
      projectId: 1,
      dueDate: "2025-01-05",
    };

    const window = resolveDueDateWindow(ticket, baseRule, now);
    const label = formatDueDateIndicator(window);

    assert.strictEqual(window, "overdue");
    assert.strictEqual(label, "Overdue");
  });
});
