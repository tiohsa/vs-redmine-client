# services

## Purpose
Implements extension-host Dashboard workflows behind the controller, including data loading, editing, selection, and synchronization actions.

## File Index
- `DashboardCommentService.ts`: Loads, selects, and opens comment workflows.
- `DashboardComposerService.ts`: Manages new-ticket composition and draft synchronization.
- `DashboardDataService.ts`: Coordinates Dashboard data, metadata, refresh, and cache.
- `DashboardDraftService.ts`: Creates and opens ticket drafts.
- `DashboardMetadataService.ts`: Loads and updates ticket metadata and drafts.
- `DashboardProjectService.ts`: Loads and resolves project selection.
- `DashboardSelectionService.ts`: Coordinates selection and active-editor following.
- `DashboardServiceContext.ts`: Defines shared state and operation notification dependencies.
- `DashboardSyncConflictService.ts`: Handles sync conflict review and resolution.
- `DashboardSyncNotifications.ts`: Translates sync outcomes into notifications.
- `DashboardTicketService.ts`: Loads, filters, paginates, and opens tickets.
- `DashboardUnsyncedQueueActions.ts`: Handles individual queue and draft actions.
- `DashboardUnsyncedService.ts`: Coordinates unsynced items, synchronization, and conflict helpers.

## Local Rules & Conventions
- Wire services through `DashboardController` and share state and notifications via `DashboardServiceContext`.
- Build published presentation data with the Dashboard view-model builders; keep request dispatch in the router.
- Preserve existing invalidation and generation checks around asynchronous loads and selection changes.
