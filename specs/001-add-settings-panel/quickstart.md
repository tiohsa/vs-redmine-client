# Phase 1 Quickstart: Project List Settings Panel

## Purpose
Validate the settings area above the project list and its behavior for filtering, sorting, and due date display.

## Preconditions
- VS Code Extension Development Host can be launched for this repository.
- Redmine data is available or mocked to include varied priorities, statuses, trackers, assignees, and due dates.

## Smoke Test Steps
1. Open the TodoEx activity view and navigate to the Ticket Settings view.
2. Confirm the Ticket Settings view appears at the top of the sidebar list.
3. Select multiple values within one filter (e.g., two statuses) and confirm the list includes tickets matching either value.
4. Add another filter field (e.g., priority) and confirm results require both fields to match.
5. Set a sort field and direction; verify list order updates accordingly.
6. Toggle due date display windows (7/3/1 days and overdue) and confirm indicators follow the closest-window rule.
7. Use the reset action and verify defaults are restored (all filters selected, no sort, all due date displays enabled).
8. Select the “Unassigned” assignee option and confirm unassigned tickets appear.

## Expected Results
- The ticket list updates immediately after each change while keeping the Ticket Settings view visible.
- Due date indicators show only the closest applicable window.
- Reset returns the list to default settings without navigation.
