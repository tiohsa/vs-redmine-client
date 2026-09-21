import * as fs from "fs";
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

const isWithinDirectory = (baseDir: string, candidate: string): boolean => {
  const relative = path.relative(baseDir, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const isMissingPathError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

const realpathOrLexicalPath = async (
  baseDir: string,
  candidate: string,
): Promise<string | undefined> => {
  const lexicalBaseDir = path.resolve(baseDir);
  const lexicalCandidate = path.resolve(candidate);
  if (!isWithinDirectory(lexicalBaseDir, lexicalCandidate)) {
    return undefined;
  }

  let realBaseDir: string;
  try {
    realBaseDir = await fs.promises.realpath(lexicalBaseDir);
  } catch (error) {
    if (!isMissingPathError(error)) {
      return undefined;
    }
    return lexicalCandidate;
  }

  let realCandidate: string | undefined;
  try {
    realCandidate = await fs.promises.realpath(lexicalCandidate);
  } catch (error) {
    if (!isMissingPathError(error)) {
      return undefined;
    }

    // The file may not exist yet. Resolve its nearest existing parent so a
    // symlinked directory cannot escape the sandbox before validation runs.
    let existingParent = path.dirname(lexicalCandidate);
    while (existingParent !== path.dirname(existingParent)) {
      try {
        const realParent = await fs.promises.realpath(existingParent);
        const suffix = path.relative(existingParent, lexicalCandidate);
        realCandidate = path.resolve(realParent, suffix);
        break;
      } catch (parentError) {
        if (!isMissingPathError(parentError)) {
          return undefined;
        }
        existingParent = path.dirname(existingParent);
      }
    }

    if (!realCandidate) {
      return lexicalCandidate;
    }
  }

  return realCandidate && isWithinDirectory(realBaseDir, realCandidate)
    ? lexicalCandidate
    : undefined;
};

export const resolveLocalPath = async (
  value: string,
  baseDir?: string,
): Promise<string | undefined> => {
  if (
    !baseDir ||
    value.includes("\0") ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value.replace(/\\/g, "/")) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    return undefined;
  }

  const normalizedValue = value.replace(/\\/g, "/");
  const candidate = path.resolve(baseDir, normalizedValue);
  return realpathOrLexicalPath(baseDir, candidate);
};

const isPlainRelativePath = (value: string): boolean => {
  if (path.isAbsolute(value)) {
    return false;
  }
  const normalized = value.split("\\").join("/");
  const dir = path.posix.dirname(normalized);
  return dir === "." || dir === "";
};

export const resolveFallbackImagePath = async (
  value: string,
  baseDir?: string,
): Promise<string | undefined> => {
  if (!baseDir) {
    return undefined;
  }
  if (!isPlainRelativePath(value)) {
    return undefined;
  }
  return resolveLocalPath(path.posix.join("images", value), baseDir);
};

export const isMissingPathReason = (reason?: string): boolean => {
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
  const resolvedPathMap = new Map<string, string | undefined>();
  let permissionDenied = false;

  for (const link of links) {
    if (isExternalMarkdownImagePath(link.path)) {
      continue;
    }

    const resolvedPath = await resolveLocalPath(link.path, input.baseDir);
    if (!resolvedPath) {
      failures.push({ path: link.path, reason: "Relative path cannot be resolved." });
      continue;
    }

    const validatePath = input.validatePath ?? ((filePath: string) =>
      validateLocalImagePath({ filePath }));
    let validation = await validatePath(resolvedPath);
    let finalPath = resolvedPath;
    if (!validation.valid && isMissingPathReason(validation.reason)) {
      const fallbackPath = await resolveFallbackImagePath(link.path, input.baseDir);
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
      resolvedPathMap.set(link.path, finalPath);
      continue;
    }

    if (resolvedMap.has(finalPath)) {
      continue;
    }

    try {
      resolvedPathMap.set(link.path, finalPath);
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

    const resolvedPath = resolvedPathMap.get(link.path);
    const entry =
      (resolvedPath ? resolvedMap.get(resolvedPath) : undefined);
    if (!resolvedPath) {
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
