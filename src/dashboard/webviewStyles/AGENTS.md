# webviewStyles

## Purpose
Defines CSS fragments for the Dashboard Webview, including responsive, compact, and accessible variants.

## File Index
- `accessibilityStyles.ts`: Focus, forced-colors, and selection contrast styles.
- `baseStyles.ts`: Theme variables and shared base styles.
- `buttonStyles.ts`: Shared button styles.
- `commentStyles.ts`: Comment and timeline styles.
- `feedbackStyles.ts`: Toast and refresh feedback styles.
- `filterStyles.ts`: Filter controls, chips, and dialog styles.
- `headerStyles.ts`: Header and compact/sidebar variants.
- `layoutStyles.ts`: Panel layout, responsive, and compact variants.
- `settingsStyles.ts`: Settings sections and footer actions.
- `ticketDetailStyles.ts`: Ticket detail, controls, and drawer styles.
- `ticketListStyles.ts`: Ticket tree, rows, and scrolling styles.
- `unsyncedStyles.ts`: Unsynced item and compact card styles.

## Local Rules & Conventions
- Register new fragments in `../dashboardStyles.ts`; its ordering controls cascade and overrides.
- Use existing theme variables and VS Code color tokens for theme-aware presentation.
- Keep selectors aligned with the HTML shell and dynamically rendered Webview markup.
