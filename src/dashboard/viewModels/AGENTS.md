# viewModels

## Purpose
Builds Dashboard protocol models from Redmine data, settings, drafts, and synchronization state.

## File Index
- `commentsDashboardViewModel.ts`: Builds comment items with editing and unsynced state.
- `settingsDashboardViewModel.ts`: Builds settings and API-key status for display.
- `ticketDashboardViewModel.ts`: Builds ticket trees, details, draft nodes, and sync states.
- `unsyncedDashboardViewModel.ts`: Builds queue items and available action information.

## Local Rules & Conventions
- Return types defined in `dashboardProtocol.ts`; keep their consumers and protocol in sync.
- Read the current connection scope when combining remote data with local draft or queue state.
- Keep presentation derivation here and workflow orchestration in Dashboard services.
