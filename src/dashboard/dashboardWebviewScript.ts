import { coreScript } from "./webviewScripts/coreScript";
import { operationFeedbackScript } from "./webviewScripts/operationFeedbackScript";
import { tabsScript } from "./webviewScripts/tabsScript";
import { layoutScript } from "./webviewScripts/layoutScript";
import { projectPickerScript } from "./webviewScripts/projectPickerScript";
import { ticketSearchScript } from "./webviewScripts/ticketSearchScript";
import { ticketFiltersScript } from "./webviewScripts/ticketFiltersScript";
import { displayHelpersScript } from "./webviewScripts/displayHelpersScript";
import { ticketListScript } from "./webviewScripts/ticketListScript";
import { ticketDetailScript } from "./webviewScripts/ticketDetailScript";
import { unsyncedScript } from "./webviewScripts/unsyncedScript";
import { commentsScript } from "./webviewScripts/commentsScript";
import { settingsScript } from "./webviewScripts/settingsScript";
import { dashboardUpdatesScript } from "./webviewScripts/dashboardUpdatesScript";

export const dashboardWebviewScript = [
  coreScript.initialization,
  operationFeedbackScript,
  tabsScript,
  layoutScript.compactMode,
  projectPickerScript.controls,
  ticketSearchScript.controls,
  layoutScript.popover,
  projectPickerScript.dismissal,
  layoutScript.layoutSelection,
  ticketSearchScript.actions,
  coreScript.persistViewState,
  ticketFiltersScript.controls,
  displayHelpersScript,
  ticketListScript.treeNavigation,
  ticketFiltersScript.filterMatching,
  ticketListScript.rendering,
  ticketDetailScript,
  ticketFiltersScript.filterChips,
  unsyncedScript,
  commentsScript,
  settingsScript,
  projectPickerScript.rendering,
  dashboardUpdatesScript,
].join("");
