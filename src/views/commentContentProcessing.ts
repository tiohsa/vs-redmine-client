import { UploadToken } from "../redmine/types";
import { validateComment } from "../utils/commentValidation";
import {
  buildMarkdownImageUploadFailureMessage,
  hasMarkdownImageUploadFailure,
  processMarkdownImageUploads,
} from "../utils/markdownImageUpload";
import { CommentSaveResult } from "./commentSaveTypes";
import { resolveUploadSummary } from "./ticketSync/ticketImageUploadSync";

import { type CommentSaveDependencies } from "./commentSyncDependencies";
import { buildResult } from "./commentSyncResult";

type ProcessedCommentContent =
  | {
      ok: true;
      content: string;
      uploads: UploadToken[];
      uploadSummary: ReturnType<typeof resolveUploadSummary>;
    }
  | { ok: false; failure: CommentSaveResult };

export const processCommentContent = async (input: {
  content: string;
  baseDir?: string;
  deps: CommentSaveDependencies;
}): Promise<ProcessedCommentContent> => {
  const uploadResult = await processMarkdownImageUploads({
    content: input.content,
    baseDir: input.baseDir,
    uploadFile: input.deps.uploadFile,
  });
  const uploadSummary = resolveUploadSummary(uploadResult.summary);
  if (hasMarkdownImageUploadFailure(uploadResult.summary)) {
    return {
      ok: false,
      failure: buildResult(
        "failed",
        buildMarkdownImageUploadFailureMessage(uploadResult.summary),
        { uploadSummary },
      ),
    };
  }
  const nextContent = uploadResult.content;
  const validation = validateComment(nextContent);
  if (!validation.valid) {
    return { ok: false, failure: buildResult("failed", validation.message ?? "Invalid comment.") };
  }
  return { ok: true, content: nextContent, uploads: uploadResult.uploads, uploadSummary };
};
