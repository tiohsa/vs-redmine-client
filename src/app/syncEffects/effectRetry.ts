import { extractHttpStatusCode } from "../../redmine/httpError";
import { isPrimaryEffect } from "./effectSelection";
import type { DurableSyncEffect, UploadRequestSnapshot } from "./effectTypes";

export const isRejectedTicketCreate = (effect: DurableSyncEffect): boolean => {
  if (effect.kind !== "ticket_create" || effect.state !== "failed" ||
      effect.failure?.disposition !== "non_retriable") { return false; }
  if (effect.failure.category !== undefined) { return effect.failure.category === "http_403"; }
  const detail = effect.failure.detail ?? "";
  return detail === "Failed to create issue (HTTP 403)." || detail === "チケットの作成に失敗しました（HTTP 403）。" ||
    /^(?:Redmine request failed \(403\)|HTTP 403|403)(?:$|[ :])/.test(detail);
};

export const canRetryEffect = (effect: DurableSyncEffect): boolean => {
  if (effect.state === "failed") {
    if (isRejectedTicketCreate(effect)) {
      const snapshot = effect.requestSnapshot;
      return snapshot?.kind === "ticket_create" && Number.isSafeInteger(snapshot.request?.projectId) &&
        snapshot.request.projectId > 0 && typeof snapshot.request.subject === "string" &&
        snapshot.request.subject.trim().length > 0 && typeof snapshot.request.description === "string" &&
        (snapshot.request.uploads === undefined || (Array.isArray(snapshot.request.uploads) &&
          snapshot.request.uploads.every((upload) => typeof upload?.token === "string" && upload.token.length > 0 &&
            typeof upload.filename === "string" && typeof upload.content_type === "string")));
    }
    return effect.failure?.disposition === "retryable";
  }
  if (effect.state === "commit_unknown") {
    if (isPrimaryEffect(effect)) {
      return effect.requestSnapshot !== undefined;
    }
    if (
      effect.kind === "attachment_upload" ||
      effect.kind === "image_upload" ||
      (typeof effect.effectId === "string" &&
        (effect.effectId.startsWith("attachment") || effect.effectId.startsWith("image")))
    ) {
      const snap = effect.requestSnapshot as UploadRequestSnapshot | undefined;
      return !!(
        snap &&
        typeof snap.contentHash === "string" &&
        snap.contentHash.length > 0 &&
        typeof snap.contentSize === "number"
      );
    }
    if (
      effect.kind === "child_create" ||
      (typeof effect.effectId === "string" && effect.effectId.startsWith("child-create"))
    ) {
      return false;
    }
    return effect.requestSnapshot !== undefined;
  }
  if (effect.state === "compensation_unknown" || effect.state === "compensation_started") {
    return true;
  }
  return false;
};

export const canRetryFailedCommentEffect = (effect: DurableSyncEffect): boolean => {
  if (effect.state !== "failed" || effect.failure?.disposition !== "retryable") {
    return false;
  }
  const code = extractHttpStatusCode(effect.failure?.detail);
  if (code === 408 || code === 502 || code === 503 || code === 504) {
    return false;
  }
  const snapshot = effect.requestSnapshot;
  if (effect.kind === "comment_create" && snapshot?.kind === "comment_create") {
    return Number.isInteger(snapshot.request?.ticketId) && snapshot.request.ticketId > 0 &&
      typeof snapshot.request.notes === "string";
  }
  if (effect.kind === "comment_update" && snapshot?.kind === "comment_update") {
    return Number.isInteger(snapshot.request?.commentId) && snapshot.request.commentId > 0 &&
      typeof snapshot.request.notes === "string";
  }
  return false;
};
