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

export const hasMarkdownImageUploadFailure = (
  summary: MarkdownImageUploadSummary,
): boolean => summary.permissionDenied || summary.failures.length > 0;

export const buildMarkdownImageUploadFailureMessage = (
  summary: MarkdownImageUploadSummary,
): string => {
  if (summary.permissionDenied) {
    return "Image upload failed: missing attachment permission.";
  }
  if (summary.failures.length > 0) {
    const details = summary.failures
      .slice(0, 3)
      .map((entry) => entry.path)
      .join(", ");
    const suffix =
      summary.failures.length > 3 ? ` and ${summary.failures.length - 3} more` : "";
    return `Image upload failed for: ${details}${suffix}.`;
  }
  return "Image upload failed.";
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

const isPlainRelativePath = (value: string): boolean => {
  if (path.isAbsolute(value)) {
    return false;
  }
  const normalized = value.split("\\").join("/");
  const dir = path.posix.dirname(normalized);
  return dir === "." || dir === "";
};

const resolveFallbackImagePath = (
  value: string,
  baseDir?: string,
): string | undefined => {
  if (!baseDir) {
    return undefined;
  }
  if (!isPlainRelativePath(value)) {
    return undefined;
  }
  return path.resolve(baseDir, "images", value);
};

const isMissingPathReason = (reason?: string): boolean => {
  if (!reason) {
    return false;
  }
  return /not found|enoent|filenotfound/i.test(reason);
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

    const validatePath = input.validatePath ?? ((filePath: string) =>
      validateLocalImagePath({ filePath }));
    let validation = await validatePath(resolvedPath);
    let finalPath = resolvedPath;
    if (!validation.valid && isMissingPathReason(validation.reason)) {
      const fallbackPath = resolveFallbackImagePath(link.path, input.baseDir);
      if (fallbackPath && fallbackPath !== resolvedPath) {
        const fallbackValidation = await validatePath(fallbackPath);
        if (fallbackValidation.valid) {
          validation = fallbackValidation;
          finalPath = fallbackPath;
        }
      }
    }

    if (!validation.valid) {
      failures.push({
        path: link.path,
        reason: validation.reason ?? "Invalid image path.",
      });
      resolvedMap.set(finalPath, { failure: validation.reason });
      continue;
    }

    if (resolvedMap.has(finalPath)) {
      continue;
    }

    try {
      const upload = await input.uploadFile(finalPath);
      resolvedMap.set(finalPath, {
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
      resolvedMap.set(finalPath, { failure: message });
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
    const fallbackPath = resolveFallbackImagePath(link.path, input.baseDir);
    const entry =
      (resolvedPath ? resolvedMap.get(resolvedPath) : undefined) ??
      (fallbackPath ? resolvedMap.get(fallbackPath) : undefined);
    if (!resolvedPath && !fallbackPath) {
      return [];
    }
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
