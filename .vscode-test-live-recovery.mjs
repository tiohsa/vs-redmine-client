import { defineConfig } from '@vscode/test-cli';
import regularConfig from './.vscode-test.mjs';

export default defineConfig({
    ...regularConfig,
    files: 'out/test/liveRedmineSyncRecovery.test.js',
});
