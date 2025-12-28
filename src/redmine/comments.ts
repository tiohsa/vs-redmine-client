import { requestJson } from "./client";
import { Comment, RedmineIssueDetailResponse, RedmineIssueDetailResponseIssue } from "./types";

export const filterEditableComments = <T extends { editableByCurrentUser: boolean }>(
  comments: T[],
): T[] => comments.filter((comment) => comment.editableByCurrentUser);

export const buildCommentUpdatePayload = (notes: string): Record<string, unknown> => ({
  journal: {
    notes,
  },
});

export const listComments = async (
  issueId: number,
  currentUserId?: number,
): Promise<Comment[]> => {
  const response = await requestJson<RedmineIssueDetailResponse>({
    method: "GET",
    path: `/issues/${issueId}.json`,
    query: { include: "journals" },
  });

  return mapIssueJournalsToComments(response.issue, currentUserId);
};

export const mapIssueJournalsToComments = (
  issue: RedmineIssueDetailResponseIssue,
  currentUserId?: number,
): Comment[] => {
  const journals = issue.journals ?? [];
  const comments: Comment[] = [];

  journals.forEach((journal, index) => {
    if ((journal.notes ?? "").trim().length === 0) {
      return;
    }

    comments.push({
      id: journal.id,
      ticketId: issue.id,
      authorId: journal.user?.id ?? 0,
      authorName: journal.user?.name ?? "Unknown",
      body: journal.notes ?? "",
      createdAt: journal.created_on,
      updatedAt: journal.updated_on,
      editableByCurrentUser:
        currentUserId !== undefined && journal.user?.id === currentUserId,
      noteIndex: index + 1,
    });
  });

  return comments;
};

export const updateComment = async (journalId: number, notes: string): Promise<void> => {
  await requestJson({
    method: "PUT",
    path: `/journals/${journalId}.json`,
    body: buildCommentUpdatePayload(notes),
  });
};

export const buildAddCommentPayload = (notes: string): Record<string, unknown> => ({
  issue: {
    notes,
  },
});

export const addComment = async (issueId: number, notes: string): Promise<void> => {
  await requestJson({
    method: "PUT",
    path: `/issues/${issueId}.json`,
    body: buildAddCommentPayload(notes),
  });
};
