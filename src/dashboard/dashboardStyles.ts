import { baseStyles } from "./webviewStyles/baseStyles";
import { headerStyles } from "./webviewStyles/headerStyles";
import { layoutStyles } from "./webviewStyles/layoutStyles";
import { filterStyles } from "./webviewStyles/filterStyles";
import { ticketListStyles } from "./webviewStyles/ticketListStyles";
import { ticketDetailStyles } from "./webviewStyles/ticketDetailStyles";
import { buttonStyles } from "./webviewStyles/buttonStyles";
import { unsyncedStyles } from "./webviewStyles/unsyncedStyles";
import { commentStyles } from "./webviewStyles/commentStyles";
import { settingsStyles } from "./webviewStyles/settingsStyles";
import { feedbackStyles } from "./webviewStyles/feedbackStyles";
import { accessibilityStyles } from "./webviewStyles/accessibilityStyles";

export const dashboardStyles = [
  baseStyles.theme,
  headerStyles.base,
  layoutStyles.base,
  filterStyles.base,
  ticketListStyles.base,
  ticketDetailStyles.base,
  buttonStyles,
  unsyncedStyles.base,
  commentStyles.base,
  settingsStyles.base,
  feedbackStyles.toast,
  layoutStyles.responsive,
  ticketListStyles.ticketIdentifier,
  commentStyles.metadata,
  baseStyles.identifierRadius,
  ticketListStyles.scrollContainer,
  ticketDetailStyles.cardAccent,
  filterStyles.quickFilters,
  ticketDetailStyles.controls,
  commentStyles.detailComments,
  feedbackStyles.syncTray,
  filterStyles.dialog,
  layoutStyles.narrowControls,
  headerStyles.compactHeader,
  layoutStyles.compactTicketPanels,
  filterStyles.compactFilters,
  ticketListStyles.compactRows,
  ticketDetailStyles.compactDetails,
  commentStyles.compactComments,
  layoutStyles.compactSecondaryPanels,
  unsyncedStyles.compactCards,
  feedbackStyles.compactSyncTray,
  settingsStyles.compactSections,
  layoutStyles.responsiveOverrides,
  baseStyles.sidebarTheme,
  headerStyles.sidebarHeader,
  layoutStyles.sidebarPanels,
  ticketListStyles.sidebarScroll,
  filterStyles.sidebarFilters,
  ticketListStyles.sidebarRows,
  settingsStyles.footerActions,
  feedbackStyles.sidebarSyncTray,
  accessibilityStyles.selectedTicketContrast,
  feedbackStyles.refreshAnimation,
  ticketListStyles.draftRows,
  ticketDetailStyles.drawer,
  commentStyles.timeline,
  accessibilityStyles.focusAndForcedColors,
].join("");
