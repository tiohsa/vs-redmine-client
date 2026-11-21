# webviewScripts

## Purpose
Provides JavaScript fragments assembled into the Dashboard Webview runtime.

## File Index
- `commentsScript.ts`: Renders and handles comments.
- `coreScript.ts`: Initializes shared state, messaging, and persisted UI state.
- `dashboardUpdatesScript.ts`: Applies host events and updates rendered state.
- `detailResizeScript.ts`: Handles detail-panel resizing and keyboard access.
- `displayHelpersScript.ts`: Provides shared display and icon helpers.
- `layoutScript.ts`: Controls layout modes, popovers, and compact display.
- `operationFeedbackScript.ts`: Displays operation feedback.
- `projectPickerScript.ts`: Controls and renders the project picker.
- `settingsScript.ts`: Renders and handles settings.
- `tabsScript.ts`: Switches Dashboard tabs.
- `ticketDetailScript.ts`: Renders ticket details and composer controls.
- `ticketFiltersScript.ts`: Controls and applies ticket filters.
- `ticketListScript.ts`: Renders the ticket tree and handles navigation.
- `ticketSearchScript.ts`: Controls and dispatches ticket searches.
- `unsyncedScript.ts`: Renders and handles unsynced items.

## Local Rules & Conventions
- Register fragments in `../dashboardWebviewScript.ts` in dependency order; fragments share one runtime scope.
- Keep business state in host-provided Dashboard state and persist Webview layout choices through VS Code state.
- Keep DOM selectors and message payloads aligned with `dashboardHtml.ts` and the Dashboard protocol.
