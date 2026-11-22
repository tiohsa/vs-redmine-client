import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: ['out/test/!(liveRedmineSyncRecovery).test.js', 'out/test/!(live)/**/*.test.js'],
	mocha: {
		require: ['./out/test/helpers/uploadSpoolSetup.js'],
		timeout: 10000,
	},
});
