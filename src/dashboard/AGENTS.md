# dashboard

## Purpose
Coordinates the extension-host Dashboard and generates its Webview HTML, styles, and scripts.

## File Index
- `DashboardController.ts`: Wires services and coordinates Dashboard operations and selection.
- `DashboardMessageRouter.ts`: Validates and dispatches Webview requests.
- `DashboardStateStore.ts`: Holds Dashboard state and notifies subscribers.
- `DashboardWebviewProvider.ts`: Hosts the Webview and connects state, messages, and controller.
- `SettingsController.ts`: Applies settings changes and publishes settings state.
- `dashboardActionIcons.ts`: Defines shared action icon paths and markup.
- `dashboardHtml.ts`: Builds the Webview HTML shell.
- `dashboardI18n.ts`: Defines and builds localized Webview strings.
- `dashboardMessageValidation.ts`: Validates incoming requests and unsynced keys.
- `dashboardProtocol.ts`: Defines Dashboard state, view models, requests, and events.
- `dashboardStyles.ts`: Assembles ordered Webview style fragments.
- `dashboardWebviewScript.ts`: Assembles ordered Webview script fragments.
- `detailPanelResize.ts`: Defines resize bounds and accessibility calculations.
- `resolveProject.ts`: Resolves selected or configured project.

## Local Rules & Conventions
- Keep request types, validation, routing, and Webview callers aligned when changing the message contract.
- Add localized text through `dashboardI18n.ts` and pass it into the HTML builder.
- Fragment order in the script and style assemblers determines shared bindings and CSS precedence.
