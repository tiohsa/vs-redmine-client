import { requestJson } from "./client";
import { Comment, RedmineIssueDetailResponse } from "./types";
import { getCurrentUserId } from "./users";

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

  const issue = response.issue;
  return (issue.journals ?? []).map((journal) => ({
    id: journal.id,
    ticketId: issue.id,
    authorId: journal.user?.id ?? 0,
    authorName: journal.user?.name ?? "Unknown",
    body: journal.notes ?? "",
    createdAt: journal.created_on,
    updatedAt: journal.updated_on,
    editableByCurrentUser:
      currentUserId !== undefined && journal.user?.id === currentUserId,
  }));
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

export const addComment = async (
  issueId: number,
  notes: string,
): Promise<number | null> => {
  await requestJson({
    method: "PUT",
    path: `/issues/${issueId}.json`,
    body: buildAddCommentPayload(notes),
  });

  try {
    const currentUserId = await getCurrentUserId();
    const response = await requestJson<RedmineIssueDetailResponse>({
      method: "GET",
      path: `/issues/${issueId}.json`,
      query: { include: "journals" },
    });

    const journals = response.issue.journals ?? [];
    journals.sort((a, b) => b.id - a.id);

    const match = journals.find(
      (j) => j.user?.id === currentUserId && j.notes === notes,
    );

    return match ? match.id : null;
  } catch (error) {
    console.error("Failed to retrieve new comment ID", error);
    return null;
  }
};
