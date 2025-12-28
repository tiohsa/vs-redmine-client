import { Comment } from "../redmine/types";

export const formatCommentLabel = (comment: Comment): string => {
  const number = comment.noteIndex;
  return `#${number} ${comment.authorName}`;
};

export const formatCommentDescription = (comment: Comment): string =>
  comment.body.slice(0, 80);
