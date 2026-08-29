import * as crypto from "crypto";
import * as fs from "fs";

export interface FileContentIdentity {
  contentHash: string;
  contentSize: number;
}

export const computeFileHashAndSize = (filePath: string): FileContentIdentity | undefined => {
  try {
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return computeBufferHashAndSize(buffer);
    }
  } catch {
    // ignore
  }
  return undefined;
};

export const computeFileHashAndSizeAsync = async (
  filePath: string,
): Promise<FileContentIdentity | undefined> => {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(filePath)) {
        return resolve(undefined);
      }
      const hash = crypto.createHash("sha256");
      let size = 0;
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });
      stream.on("end", () => {
        resolve({
          contentHash: hash.digest("hex"),
          contentSize: size,
        });
      });
      stream.on("error", () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
};

export const computeBufferHashAndSize = (buffer: Buffer | Uint8Array): FileContentIdentity => {
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    contentHash,
    contentSize: buffer.length,
  };
};
