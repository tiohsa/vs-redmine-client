import { DashboardMessage } from "./dashboardTypes";

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number";
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export const validateDashboardMessage = (raw: unknown): DashboardMessage | null => {
  if (!isObject(raw)) {return null;}
  const { type } = raw;
  if (!isString(type)) {return null;}

  switch (type) {
    case "dashboard.ready":
      return { type };

    case "project.select":
      if (!isNumber(raw.projectId)) {return null;}
      return { type, projectId: raw.projectId };

    case "project.refresh":
      return { type };

    case "project.openInBrowser":
      if (!isNumber(raw.projectId)) {return null;}
      return { type, projectId: raw.projectId };

    case "tickets.loadMore":
      return { type };

    case "ticket.select":
      if (!isNumber(raw.ticketId)) {return null;}
      return { type, ticketId: raw.ticketId };

    case "ticket.toggleExpand":
      if (!isNumber(raw.ticketId)) {return null;}
      return { type, ticketId: raw.ticketId };

    case "ticket.openInEditor":
      if (!isNumber(raw.ticketId)) {return null;}
      return { type, ticketId: raw.ticketId };

    case "ticket.openInBrowser":
      if (!isNumber(raw.ticketId)) {return null;}
      return { type, ticketId: raw.ticketId };

    case "ticket.createNew":
      return { type };

    case "ticket.createChild":
      if (!isNumber(raw.parentTicketId)) {return null;}
      return { type, parentTicketId: raw.parentTicketId };

    case "comment.add":
      if (!isNumber(raw.ticketId)) {return null;}
      return { type, ticketId: raw.ticketId };

    case "comment.edit":
      if (!isNumber(raw.ticketId) || !isNumber(raw.commentId)) {return null;}
      return { type, ticketId: raw.ticketId, commentId: raw.commentId };

    case "unsynced.syncOne": {
      const kind = raw.kind;
      if (kind !== "ticket" && kind !== "newTicket" && kind !== "comment") {return null;}
      return {
        type,
        kind,
        ticketId: isNumber(raw.ticketId) ? raw.ticketId : undefined,
        commentId: isNumber(raw.commentId) ? raw.commentId : undefined,
        documentUri: isString(raw.documentUri) ? raw.documentUri : undefined,
      };
    }

    case "unsynced.syncAll":
      return { type };

    case "unsynced.openLocalFile":
      if (!isString(raw.documentUri) || !isString(raw.requestId)) {return null;}
      return { type, documentUri: raw.documentUri, requestId: raw.requestId };

    case "settings.update":
      if (!isObject(raw.settings)) {return null;}
      return { type, settings: raw.settings as Partial<import("./dashboardTypes").DashboardSettingsState> };

    case "tab.switch": {
      const tab = raw.tab;
      if (tab !== "tickets" && tab !== "comments" && tab !== "unsynced" && tab !== "settings") {return null;}
      return { type, tab };
    }

    default:
      return null;
  }
};
