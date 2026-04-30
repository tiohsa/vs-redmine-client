import * as crypto from "crypto";

export const computeNotesHash = (notes: string): string => {
  const hash = crypto.createHash("sha256").update(notes, "utf8").digest("hex");
  return `sha256:${hash}`;
};
