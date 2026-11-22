export const normalizeTicketText = (text: string | undefined | null): string => {
  if (text === undefined || text === null) {
    return "";
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
};

export const reconcileTicketCandidate = async (
  candidateTicketId: number,
  expected: { projectId?: number; subject?: string; description?: string },
  getIssueDetailFn: (id: number) => Promise<any>,
): Promise<
  | { ok: true; ticketId: number; projectId: number; remoteUpdatedAt: string; canonical: any }
  | { ok: false; message: string }
> => {
  try {
    const detail = await getIssueDetailFn(candidateTicketId);
    if (!detail || !detail.ticket) {
      return { ok: false, message: `Ticket #${candidateTicketId} not found.` };
    }
    const ticket = detail.ticket;
    if (expected.projectId !== undefined && expected.projectId > 0 && ticket.projectId !== expected.projectId) {
      return {
        ok: false,
        message: `Project mismatch: candidate ticket #${candidateTicketId} belongs to project #${ticket.projectId}, expected #${expected.projectId}.`,
      };
    }
    if (expected.subject !== undefined && expected.subject.trim().length > 0) {
      if (normalizeTicketText(ticket.subject) !== normalizeTicketText(expected.subject)) {
        return {
          ok: false,
          message: `Subject mismatch: candidate ticket #${candidateTicketId} subject does not match intended subject.`,
        };
      }
    }
    return {
      ok: true,
      ticketId: ticket.id,
      projectId: ticket.projectId,
      remoteUpdatedAt: ticket.updatedAt,
      canonical: detail,
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message ?? `Failed to fetch candidate ticket #${candidateTicketId}`,
    };
  }
};

export type CompensationIdentityVerificationResult =
  | { ok: true }
  | { ok: false; reason: string; kind: "mismatch" | "insufficient_identity" };

export const verifyCompensationIdentity = (
  remoteTicket: { id: number; projectId?: number; parentId?: number; subject?: string },
  expected: { projectId?: number; parentId?: number; subject?: string },
): CompensationIdentityVerificationResult => {
  if (expected.projectId !== undefined && expected.projectId > 0) {
    if (remoteTicket.projectId === undefined || remoteTicket.projectId === 0) {
      return {
        ok: false,
        kind: "insufficient_identity",
        reason: `Remote ticket #${remoteTicket.id} is missing projectId, expected #${expected.projectId}.`,
      };
    }
    if (remoteTicket.projectId !== expected.projectId) {
      return {
        ok: false,
        kind: "mismatch",
        reason: `Project mismatch: ticket #${remoteTicket.id} belongs to project #${remoteTicket.projectId}, expected #${expected.projectId}.`,
      };
    }
  }

  if (expected.parentId !== undefined && expected.parentId > 0) {
    if (remoteTicket.parentId === undefined || remoteTicket.parentId === 0) {
      return {
        ok: false,
        kind: "insufficient_identity",
        reason: `Remote ticket #${remoteTicket.id} is missing parentId, expected #${expected.parentId}.`,
      };
    }
    if (remoteTicket.parentId !== expected.parentId) {
      return {
        ok: false,
        kind: "mismatch",
        reason: `Parent ticket ID mismatch: ticket #${remoteTicket.id} has parent #${remoteTicket.parentId}, expected #${expected.parentId}.`,
      };
    }
  }

  if (expected.subject !== undefined && expected.subject.trim().length > 0) {
    if (remoteTicket.subject === undefined || remoteTicket.subject === null) {
      return {
        ok: false,
        kind: "insufficient_identity",
        reason: `Remote ticket #${remoteTicket.id} is missing subject, expected "${expected.subject}".`,
      };
    }
    if (normalizeTicketText(remoteTicket.subject) !== normalizeTicketText(expected.subject)) {
      return {
        ok: false,
        kind: "mismatch",
        reason: `Subject mismatch: ticket #${remoteTicket.id} subject "${remoteTicket.subject}" does not match expected "${expected.subject}".`,
      };
    }
  }

  return { ok: true };
};
