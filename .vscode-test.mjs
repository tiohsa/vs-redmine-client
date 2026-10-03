import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	mocha: {
		require: ['./out/test/helpers/uploadSpoolSetup.js'],
		timeout: 10000,
	},
});
