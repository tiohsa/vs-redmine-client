import * as crypto from "crypto";
import * as fs from "fs";

export interface FileContentIdentity {
  contentHash: string;
  contentSize: number;
}

export const computeFileHashAndSize = (filePath: string): FileContentIdentity | undefined => {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const buffer = fs.readFileSync(filePath);
    return computeBufferHashAndSize(buffer);
  } catch {
    return undefined;
  }
};

export const computeBufferHashAndSize = (buffer: Buffer): FileContentIdentity => {
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    contentHash,
    contentSize: buffer.length,
  };
};
