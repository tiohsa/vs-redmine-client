export interface CommentValidationResult {
  valid: boolean;
  message?: string;
}

const MAX_COMMENT_LENGTH = 20000;

export const validateComment = (text: string): CommentValidationResult => {
  if (text.trim().length === 0) {
    return { valid: false, message: "Comment cannot be empty." };
  }

  if (text.length > MAX_COMMENT_LENGTH) {
    return {
      valid: false,
      message: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer.`,
    };
  }

  return { valid: true };
};

export const getCommentLimitGuidance = (): string =>
  `Max ${MAX_COMMENT_LENGTH} characters.`;
