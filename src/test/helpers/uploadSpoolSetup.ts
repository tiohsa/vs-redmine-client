import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DurableUploadSpoolStore, setDefaultUploadSpoolStore } from "../../app/ticketSync/uploadSpoolStore";

// Extension activation がない handler テストにも、明示的な storage fixture を与える。
const globalStoragePath = fs.mkdtempSync(path.join(os.tmpdir(), "redmine-test-global-storage-"));
setDefaultUploadSpoolStore(new DurableUploadSpoolStore(globalStoragePath, "extension-host-tests"));
export const mochaGlobalTeardown = (): void => {
  fs.rmSync(globalStoragePath, { recursive: true, force: true });
};
