import * as path from "path";
import { UploadToken } from "../redmine/types";
import {
  applyMarkdownImageReplacements,
  extractMarkdownImageLinks,
  isExternalMarkdownImagePath,
} from "./markdownImageLinks";
import { MarkdownImageValidationResult, validateLocalImagePath } from "./markdownImageValidation";

export type MarkdownImageUploadFailure = {
  path: string;
  reason: string;
};

export type MarkdownImageUploadSummary = {
  failures: MarkdownImageUploadFailure[];
  permissionDenied: boolean;
};

export type MarkdownImageUploadResult = {
  content: string;
  uploads: UploadToken[];
  summary: MarkdownImageUploadSummary;
};

type UploadResult = {
  token: string;
  filename: string;
  contentType: string;
};

const isPermissionDeniedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("(403)") || message.toLowerCase().includes("forbidden");
};

const resolveLocalPath = (value: string, baseDir?: string): string | undefined => {
  if (path.isAbsolute(value)) {
    return value;
  }
  if (!baseDir) {
    return undefined;
  }
  return path.resolve(baseDir, value);
};

export const processMarkdownImageUploads = async (input: {
  content: string;
  baseDir?: string;
  uploadFile: (filePath: string) => Promise<UploadResult>;
  validatePath?: (filePath: string) => Promise<MarkdownImageValidationResult>;
}): Promise<MarkdownImageUploadResult> => {
  const links = extractMarkdownImageLinks(input.content);
  if (links.length === 0) {
    return {
      content: input.content,
      uploads: [],
      summary: { failures: [], permissionDenied: false },
    };
  }

  const failures: MarkdownImageUploadFailure[] = [];
  const resolvedMap = new Map<string, { upload?: UploadToken; failure?: string }>();
  let permissionDenied = false;

  for (const link of links) {
    if (isExternalMarkdownImagePath(link.path)) {
      continue;
    }

    const resolvedPath = resolveLocalPath(link.path, input.baseDir);
    if (!resolvedPath) {
      failures.push({ path: link.path, reason: "Relative path cannot be resolved." });
      continue;
    }
    if (resolvedMap.has(resolvedPath)) {
      continue;
    }

    const validatePath = input.validatePath ?? ((filePath: string) =>
      validateLocalImagePath({ filePath }));
    const validation = await validatePath(resolvedPath);
    if (!validation.valid) {
      failures.push({
        path: link.path,
        reason: validation.reason ?? "Invalid image path.",
      });
      resolvedMap.set(resolvedPath, { failure: validation.reason });
      continue;
    }

    try {
      const upload = await input.uploadFile(resolvedPath);
      resolvedMap.set(resolvedPath, {
        upload: {
          token: upload.token,
          filename: upload.filename,
          content_type: upload.contentType,
        },
      });
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        permissionDenied = true;
        break;
      }
      const message = error instanceof Error ? error.message : "Upload failed.";
      failures.push({ path: link.path, reason: message });
      resolvedMap.set(resolvedPath, { failure: message });
    }
  }

  if (permissionDenied) {
    return {
      content: input.content,
      uploads: [],
      summary: { failures: [], permissionDenied: true },
    };
  }

  const replacements = links.flatMap((link) => {
    if (isExternalMarkdownImagePath(link.path)) {
      return [];
    }

    const resolvedPath = resolveLocalPath(link.path, input.baseDir);
    if (!resolvedPath) {
      return [];
    }
    const entry = resolvedMap.get(resolvedPath);
    if (!entry?.upload) {
      return [];
    }
    return [{ range: link.range, value: entry.upload.filename }];
  });

  return {
    content: applyMarkdownImageReplacements(input.content, replacements),
    uploads: Array.from(resolvedMap.values())
      .map((entry) => entry.upload)
      .filter((entry): entry is UploadToken => Boolean(entry)),
    summary: { failures, permissionDenied: false },
  };
};
