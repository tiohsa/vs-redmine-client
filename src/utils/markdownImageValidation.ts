import * as path from "path";
import * as vscode from "vscode";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export type MarkdownImageValidationResult = {
  valid: boolean;
  reason?: string;
  sizeBytes?: number;
};

export const isSupportedImageExtension = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
};

export const validateLocalImagePath = async (input: {
  filePath: string;
  statFile?: (uri: vscode.Uri) => Thenable<vscode.FileStat>;
  maxBytes?: number;
}): Promise<MarkdownImageValidationResult> => {
  if (!isSupportedImageExtension(input.filePath)) {
    return { valid: false, reason: "Unsupported image extension." };
  }

  const statFile = input.statFile ?? vscode.workspace.fs.stat;
  let stat: vscode.FileStat;
  try {
    stat = await statFile(vscode.Uri.file(input.filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "File not found.";
    return { valid: false, reason: message };
  }

  const maxBytes = input.maxBytes ?? MAX_IMAGE_BYTES;
  if (stat.size > maxBytes) {
    return {
      valid: false,
      reason: `Image exceeds ${Math.floor(maxBytes / (1024 * 1024))}MB limit.`,
      sizeBytes: stat.size,
    };
  }

  return { valid: true, sizeBytes: stat.size };
};

export const getImageSizeLimitBytes = (): number => MAX_IMAGE_BYTES;
