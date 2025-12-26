import { Buffer } from "buffer";
import * as path from "path";
import * as vscode from "vscode";
import { requestJson } from "./client";
import { RedmineUploadResponse } from "./types";

export interface UploadResult {
  token: string;
  filename: string;
  contentType: string;
}

export interface ClipboardImageData {
  buffer: Uint8Array;
  contentType: string;
  filename: string;
}

const getContentType = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "application/octet-stream";
};

const uploadBuffer = async (
  buffer: Uint8Array,
  filename: string,
  contentType: string,
): Promise<UploadResult> => {
  const response = await requestJson<RedmineUploadResponse>({
    method: "POST",
    path: "/uploads.json",
    query: { filename },
    body: buffer,
    contentType: "application/octet-stream",
    headers: {
      "Content-Type": "application/octet-stream",
    },
  });

  return {
    token: response.upload.token,
    filename,
    contentType,
  };
};

export const uploadFileAttachment = async (filePath: string): Promise<UploadResult> => {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  const filename = path.basename(filePath);
  const contentType = getContentType(filename);
  return uploadBuffer(bytes, filename, contentType);
};

export const uploadClipboardImage = async (): Promise<UploadResult> => {
  const clipboardText = await vscode.env.clipboard.readText();
  if (!clipboardText) {
    throw new Error("Clipboard is empty.");
  }

  const parsed = parseClipboardImageDataUri(clipboardText);
  return uploadBuffer(parsed.buffer, parsed.filename, parsed.contentType);
};

export const parseClipboardImageDataUri = (dataUri: string): ClipboardImageData => {
  const match = dataUri.match(/^data:(image\/(png|jpeg|jpg|gif));base64,(.+)$/);
  if (!match) {
    throw new Error("Clipboard does not contain an image data URI.");
  }

  const contentType = match[1];
  const base64 = match[3];
  const buffer = Uint8Array.from(Buffer.from(base64, "base64"));
  const extension = contentType.split("/")[1] || "png";
  const filename = `clipboard-image.${extension}`;

  return { buffer, contentType, filename };
};
