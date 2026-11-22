import type { DashboardRequest } from "./dashboardProtocol";
import { EDITOR_DEFAULT_FIELDS } from "../config/settings";
import { isBoolean, isNonEmptyString, isNumber, isObject, isPositiveInt, isString } from "./dashboardValidationPrimitives";
import { validateConnectionPatch, validateEditorPatch, validateGeneralPatch, validateSettingsPatch } from "./dashboardSettingsValidation";
import { validateDashboardUnsyncedKey } from "./dashboardUnsyncedKeyValidation";
export { validateDashboardUnsyncedKey } from "./dashboardUnsyncedKeyValidation";
import {
  normalizeEditorDefaultValue,
  validateEditorDefaultValue,
} from "../views/ticketEditorDefaultsValidation";

type ValidationResult =
  | { ok: true; request: DashboardRequest }
  | { ok: false; reason: string };

const isNonNegativeInt = (v: unknown): v is number => isNumber(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === "string");
const METADATA_PATCH_FIELDS = new Set(["tracker", "priority", "status", "due_date", "start_date", "assignee"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const hasValidDateField = (
  value: Record<string, unknown>,
  field: "due_date" | "start_date",
): boolean => {
  if (!(field in value)) { return true; }
  const date = value[field];
  return isString(date) && (date.length === 0 || DATE_RE.test(date));
};

const validateMetadataPatch = (v: unknown): boolean => {
  if (!isObject(v)) { return false; }
  const keys = Object.keys(v);
  if (keys.length === 0) { return false; }
  if (keys.some((key) => !METADATA_PATCH_FIELDS.has(key))) { return false; }
  for (const key of ["tracker", "priority", "status"]) {
    if (key in v && !isNonEmptyString(v[key])) { return false; }
  }
  if (!hasValidDateField(v, "due_date")) { return false; }
  if (!hasValidDateField(v, "start_date")) { return false; }
  if ("assignee" in v && !isString(v["assignee"])) { return false; }
  return true;
};

export const validateDashboardMessage = (raw: unknown): ValidationResult => {
  if (!isObject(raw)) {
    return { ok: false, reason: "message is not an object" };
  }

  const type = raw["type"];
  const requestId = raw["requestId"];

  if (!isString(type)) {
    return { ok: false, reason: "type must be a string" };
  }
  if (!isString(requestId)) {
    return { ok: false, reason: "requestId must be a string" };
  }

  switch (type) {
    case "dashboard.ready":
    case "dashboard.refresh":
    case "dashboard.resetCache":
      return { ok: true, request: { type, requestId } };

    case "project.select": {
      const projectId = raw["projectId"];
      if (!isPositiveInt(projectId)) {
        return { ok: false, reason: "project.select: projectId must be a positive integer" };
      }
      if ("query" in raw && !isString(raw["query"])) {
        return { ok: false, reason: "project.select: query must be a string" };
      }
      return { ok: true, request: { type, requestId, projectId, ...(isString(raw["query"]) ? { query: raw["query"] } : {}) } };
    }

    case "project.selectAll": {
      const query = raw["query"];
      if (query !== undefined && !isString(query)) {
        return { ok: false, reason: "project.selectAll: query must be a string" };
      }
      return { ok: true, request: { type, requestId, ...(query !== undefined ? { query } : {}) } };
    }

    case "tickets.search": {
      const query = raw["query"];
      const scope = raw["scope"];
      if (!isString(query) || !isObject(scope)) {
        return { ok: false, reason: "tickets.search: invalid query or scope" };
      }
      if (scope["kind"] === "all" && !("projectId" in scope)) {
        return { ok: true, request: { type, requestId, query, scope: { kind: "all" } } };
      }
      if (scope["kind"] === "project" && isPositiveInt(scope["projectId"]) && Number.isSafeInteger(scope["projectId"])) {
        return { ok: true, request: { type, requestId, query, scope: { kind: "project", projectId: scope["projectId"] } } };
      }
      return { ok: false, reason: "tickets.search: invalid scope" };
    }

    case "project.toggleChildren": {
      const include = raw["includeChildProjects"];
      if (!isBoolean(include)) {
        return { ok: false, reason: "project.toggleChildren: includeChildProjects must be a boolean" };
      }
      return { ok: true, request: { type, requestId, includeChildProjects: include } };
    }

    case "tickets.refresh":
      return { ok: true, request: { type, requestId } };

    case "tickets.searchAllProjects": {
      const query = raw["query"];
      if (!isString(query)) {
        return { ok: false, reason: "tickets.searchAllProjects: query must be a string" };
      }
      return { ok: true, request: { type, requestId, query } };
    }

    case "tickets.loadMore":
      return { ok: true, request: { type, requestId } };

    case "deleteTicket": {
      const ticketId = raw["ticketId"];
      const connectionGeneration = raw["connectionGeneration"];
      if (!isPositiveInt(ticketId) || !isNonNegativeInt(connectionGeneration)) {
        return { ok: false, reason: "deleteTicket: invalid ticketId or connectionGeneration" };
      }
      return { ok: true, request: { type, requestId, ticketId, connectionGeneration } };
    }

    case "deleteComment": {
      const ticketId = raw["ticketId"];
      const commentId = raw["commentId"];
      const connectionGeneration = raw["connectionGeneration"];
      if (!isPositiveInt(ticketId) || !isPositiveInt(commentId) || !isNonNegativeInt(connectionGeneration)) {
        return { ok: false, reason: "deleteComment: invalid IDs or connectionGeneration" };
      }
      return { ok: true, request: { type, requestId, ticketId, commentId, connectionGeneration } };
    }

    case "ticket.select": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.select: ticketId must be a positive integer" };
      }
      if ("preserveFocus" in raw && raw["preserveFocus"] !== undefined && !isBoolean(raw["preserveFocus"])) {
        return { ok: false, reason: "ticket.select: preserveFocus must be a boolean" };
      }
      const preserveFocus = raw["preserveFocus"] as boolean | undefined;
      return {
        ok: true,
        request: {
          type,
          requestId,
          ticketId,
          ...(preserveFocus !== undefined ? { preserveFocus } : {}),
        },
      };
    }

    case "ticket.openEditor": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.openEditor: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.reviewConflict": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.reviewConflict: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.openBrowser": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.openBrowser: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "ticket.create": {
      if ("projectId" in raw && raw["projectId"] !== undefined && !isPositiveInt(raw["projectId"])) {
        return { ok: false, reason: "ticket.create: projectId must be a positive integer" };
      }
      const projectId = raw["projectId"] as number | undefined;
      return {
        ok: true,
        request: {
          type,
          requestId,
          ...(projectId !== undefined ? { projectId } : {}),
        },
      };
    }

    case "ticket.openDraft": {
      const queueId = raw["queueId"];
      const documentUri = raw["documentUri"];
      if (!isNonEmptyString(queueId)) {
        return { ok: false, reason: "ticket.openDraft: queueId must be a non-empty string" };
      }
      if (!isNonEmptyString(documentUri)) {
        return { ok: false, reason: "ticket.openDraft: documentUri must be a non-empty string" };
      }
      if ("preserveFocus" in raw && raw["preserveFocus"] !== undefined && !isBoolean(raw["preserveFocus"])) {
        return { ok: false, reason: "ticket.openDraft: preserveFocus must be a boolean" };
      }
      const preserveFocus = raw["preserveFocus"] as boolean | undefined;
      return {
        ok: true,
        request: {
          type,
          requestId,
          queueId,
          documentUri,
          ...(preserveFocus !== undefined ? { preserveFocus } : {}),
        },
      };
    }

    case "ticket.syncDraft": {
      const queueId = raw["queueId"];
      const documentUri = raw["documentUri"];
      if (!isNonEmptyString(queueId)) {
        return { ok: false, reason: "ticket.syncDraft: queueId must be a non-empty string" };
      }
      if (!isNonEmptyString(documentUri)) {
        return { ok: false, reason: "ticket.syncDraft: documentUri must be a non-empty string" };
      }
      return { ok: true, request: { type, requestId, queueId, documentUri } };
    }

    case "ticket.createChild": {
      const parentTicketId = raw["parentTicketId"];
      if (!isPositiveInt(parentTicketId)) {
        return { ok: false, reason: "ticket.createChild: parentTicketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, parentTicketId } };
    }

    case "ticket.cancelDetail":
    case "ticket.cancelComposer":
      return { ok: true, request: { type, requestId } };

    case "ticket.syncNewTicketDraftFromComposer":
      return { ok: true, request: { type, requestId } };

    case "ticket.createDraftFromComposer": {
      const values = raw["values"];
      if (!isObject(values)) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values must be an object" };
      }
      if (!isNonEmptyString(values["tracker"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.tracker must be a non-empty string" };
      }
      if (!isNonEmptyString(values["priority"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.priority must be a non-empty string" };
      }
      if ("status" in values && values["status"] !== undefined && values["status"] !== "" && !isString(values["status"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.status must be a string" };
      }
      if ("start_date" in values && values["start_date"] !== undefined && values["start_date"] !== "") {
        if (!isString(values["start_date"]) || !DATE_RE.test(values["start_date"] as string)) {
          return { ok: false, reason: "ticket.createDraftFromComposer: values.start_date must be YYYY-MM-DD or empty" };
        }
      }
      if ("due_date" in values && values["due_date"] !== undefined && values["due_date"] !== "") {
        if (!isString(values["due_date"]) || !DATE_RE.test(values["due_date"] as string)) {
          return { ok: false, reason: "ticket.createDraftFromComposer: values.due_date must be YYYY-MM-DD or empty" };
        }
      }
      if ("assigned_to" in values && values["assigned_to"] !== undefined && !isString(values["assigned_to"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.assigned_to must be a string" };
      }
      if ("description" in values && values["description"] !== undefined && !isString(values["description"])) {
        return { ok: false, reason: "ticket.createDraftFromComposer: values.description must be a string" };
      }
      return {
        ok: true,
        request: {
          type,
          requestId,
          values: {
            tracker: values["tracker"] as string,
            priority: values["priority"] as string,
            status: (values["status"] as string | undefined) ?? "",
            assigned_to: (values["assigned_to"] as string | undefined) ?? undefined,
            start_date: (values["start_date"] as string | undefined) ?? undefined,
            due_date: (values["due_date"] as string | undefined) ?? undefined,
            description: (values["description"] as string | undefined) ?? undefined,
          },
        },
      };
    }

    case "ticket.metadata.update": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.metadata.update: ticketId must be a positive integer" };
      }
      const patch = raw["patch"];
      if (!validateMetadataPatch(patch)) {
        return { ok: false, reason: "ticket.metadata.update: patch is invalid" };
      }
      return { ok: true, request: { type, requestId, ticketId, patch: patch as import("./dashboardProtocol").TicketMetadataPatch } };
    }

    case "ticket.syncSelected": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "ticket.syncSelected: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "comment.add": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.add: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "comment.edit": {
      const ticketId = raw["ticketId"];
      const commentId = raw["commentId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.edit: ticketId must be a positive integer" };
      }
      if (!isPositiveInt(commentId)) {
        return { ok: false, reason: "comment.edit: commentId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId, commentId } };
    }

    case "comment.openBrowser": {
      const ticketId = raw["ticketId"];
      const commentId = raw["commentId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.openBrowser: ticketId must be a positive integer" };
      }
      if (!isPositiveInt(commentId)) {
        return { ok: false, reason: "comment.openBrowser: commentId must be a positive integer" };
      }
      const noteIndex = raw["noteIndex"];
      return { ok: true, request: { type, requestId, ticketId, commentId, noteIndex: isPositiveInt(noteIndex) ? noteIndex : undefined } };
    }

    case "comment.syncSelected": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.syncSelected: ticketId must be a positive integer" };
      }
      const rawCommentId = raw["commentId"];
      if (rawCommentId !== undefined && !isPositiveInt(rawCommentId)) {
        return { ok: false, reason: "comment.syncSelected: commentId must be a positive integer" };
      }
      const rawDocumentUri = raw["documentUri"];
      if (rawDocumentUri !== undefined && !isNonEmptyString(rawDocumentUri)) {
        return { ok: false, reason: "comment.syncSelected: documentUri must be a non-empty string" };
      }
      if (rawCommentId === undefined && rawDocumentUri === undefined) {
        return { ok: false, reason: "comment.syncSelected: commentId or documentUri is required" };
      }
      return {
        ok: true,
        request: {
          type,
          requestId,
          ticketId,
          ...(rawCommentId !== undefined ? { commentId: rawCommentId } : {}),
          ...(rawDocumentUri !== undefined ? { documentUri: rawDocumentUri } : {}),
        },
      };
    }

    case "comment.reload": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "comment.reload: ticketId must be a positive integer" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "unsynced.openPendingChange":
    case "unsynced.discardPendingChange": {
      const itemId = raw["itemId"];
      if (typeof itemId !== "string" || !/^[a-f0-9]{64}$/.test(itemId)) {
        return { ok: false, reason: `${type}: invalid itemId` };
      }
      return { ok: true, request: { type, requestId, itemId } };
    }

    case "unsynced.openLocalFile": {
      const documentUri = raw["documentUri"];
      if (!isNonEmptyString(documentUri)) {
        return { ok: false, reason: "unsynced.openLocalFile: documentUri must be a non-empty string" };
      }
      return { ok: true, request: { type, requestId, documentUri } };
    }

    case "unsynced.syncOne":
    case "unsynced.discardOne":
    case "unsynced.abandonOne":
    case "unsynced.forgetAbandoned": {
      const key = raw["key"];
      if (!validateDashboardUnsyncedKey(key)) {
        return { ok: false, reason: `${type}: key is invalid` };
      }
      return { ok: true, request: { type, requestId, key } };
    }

    case "unsynced.syncAll":
    case "unsynced.forgetAllAbandoned":
      return { ok: true, request: { type, requestId } };

    case "unsynced.startNewTicketEdit": {
      const ticketId = raw["ticketId"];
      if (!isPositiveInt(ticketId)) {
        return { ok: false, reason: "unsynced.startNewTicketEdit: ticketId is invalid" };
      }
      return { ok: true, request: { type, requestId, ticketId } };
    }

    case "settings.update": {
      const patch = raw["patch"];
      if (!validateSettingsPatch(patch)) {
        return { ok: false, reason: "settings.update: patch is invalid" };
      }
      return { ok: true, request: { type, requestId, patch: patch as import("./dashboardProtocol").DashboardSettingsPatch } };
    }

    case "settings.reset":
      return { ok: true, request: { type, requestId } };

    case "settings.updateEditorDefault": {
      const field = raw["field"];
      const value = raw["value"];
      if (!isString(field) || !(EDITOR_DEFAULT_FIELDS as readonly string[]).includes(field)) {
        return { ok: false, reason: `settings.updateEditorDefault: field must be one of ${EDITOR_DEFAULT_FIELDS.join(", ")}` };
      }
      if (!isString(value)) {
        return { ok: false, reason: "settings.updateEditorDefault: value must be a string" };
      }
      const editorField = field as import("../config/settings").EditorDefaultField;
      const normalizedValue = normalizeEditorDefaultValue(editorField, value);
      if (validateEditorDefaultValue(editorField, normalizedValue)) {
        return { ok: false, reason: "settings.updateEditorDefault: value is invalid" };
      }
      return { ok: true, request: { type, requestId, field, value: normalizedValue } };
    }

    case "settings.resetEditorDefaults": {
      const fields = raw["fields"];
      if (!isStringArray(fields)) {
        return { ok: false, reason: "settings.resetEditorDefaults: fields must be an array of strings" };
      }
      const validFields = (EDITOR_DEFAULT_FIELDS as readonly string[]);
      const invalid = fields.find((f) => !validFields.includes(f));
      if (invalid !== undefined) {
        return { ok: false, reason: `settings.resetEditorDefaults: unknown field "${invalid}"` };
      }
      return { ok: true, request: { type, requestId, fields } };
    }

    case "settings.updateConnection": {
      const patch = raw["patch"];
      if (!validateConnectionPatch(patch)) {
        return { ok: false, reason: "settings.updateConnection: patch is invalid" };
      }
      return {
        ok: true,
        request: {
          type,
          requestId,
          patch: patch as import("./dashboardProtocol").DashboardConnectionSettingsPatch,
        },
      };
    }

    case "settings.updateEditor": {
      const patch = raw["patch"];
      if (!validateEditorPatch(patch)) {
        return { ok: false, reason: "settings.updateEditor: patch is invalid" };
      }
      return {
        ok: true,
        request: {
          type,
          requestId,
          patch: patch as import("./dashboardProtocol").DashboardEditorSettingsPatch,
        },
      };
    }

    case "settings.updateGeneral": {
      const patch = raw["patch"];
      if (!validateGeneralPatch(patch)) {
        return { ok: false, reason: "settings.updateGeneral: patch is invalid" };
      }
      return { ok: true, request: { type, requestId, patch: patch as import("./dashboardProtocol").DashboardGeneralSettingsPatch } };
    }

    case "settings.openJson":
    case "apiKey.set":
    case "apiKey.clear":
      return { ok: true, request: { type, requestId } };

    default:
      return { ok: false, reason: `unknown message type: ${String(type)}` };
  }
};
