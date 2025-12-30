import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export const createTempImage = (): {
  dir: string;
  documentUri: vscode.Uri;
  imagePath: string;
} => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todoex-mdimg-"));
  const imagePath = path.join(dir, "image.png");
  fs.writeFileSync(imagePath, Buffer.from([1, 2, 3]));
  return { dir, documentUri: vscode.Uri.file(path.join(dir, "comment.md")), imagePath };
};
