import { normalizeBaseUrl } from "../redmine/client";

type UrlResult = {
  url?: string;
  errorMessage?: string;
};

const resolveBaseUrl = (rawBaseUrl: string): UrlResult => {
  const baseUrl = rawBaseUrl.trim();
  if (!baseUrl) {
    return { errorMessage: "Missing Redmine base URL configuration." };
  }

  try {
    return { url: normalizeBaseUrl(baseUrl) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid base URL.";
    return { errorMessage: message };
  }
};

export const buildProjectUrl = (
  rawBaseUrl: string,
  identifier?: string,
): UrlResult => {
  const base = resolveBaseUrl(rawBaseUrl);
  if (!base.url) {
    return base;
  }
  if (!identifier) {
    return { errorMessage: "Project identifier is missing." };
  }

  const encoded = encodeURIComponent(identifier);
  const url = new URL(`projects/${encoded}`, base.url);
  return { url: url.toString() };
};

export const buildTicketUrl = (rawBaseUrl: string, ticketId?: number): UrlResult => {
  const base = resolveBaseUrl(rawBaseUrl);
  if (!base.url) {
    return base;
  }
  if (!ticketId) {
    return { errorMessage: "Ticket ID is missing." };
  }

  const url = new URL(`issues/${ticketId}`, base.url);
  return { url: url.toString() };
};

export const buildCommentUrl = (
  rawBaseUrl: string,
  ticketId?: number,
  commentId?: number,
  noteIndex?: number,
): UrlResult => {
  const base = resolveBaseUrl(rawBaseUrl);
  if (!base.url) {
    return base;
  }
  if (!ticketId) {
    return { errorMessage: "Ticket ID is missing." };
  }
  const anchorId = noteIndex ?? commentId;
  if (!anchorId) {
    return { errorMessage: "Comment ID is missing." };
  }

  const url = new URL(`issues/${ticketId}`, base.url);
  url.hash = `note-${anchorId}`;
  return { url: url.toString() };
};
