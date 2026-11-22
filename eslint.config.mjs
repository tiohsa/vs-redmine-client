import typescriptEslint from "typescript-eslint";
import meaningfulTest from "./verification/test-quality-rule.mjs";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, {
    files: ["src/test/**/*.ts", "verification/**/*.test.cjs"],
    linterOptions: {
        noInlineConfig: true,
    },
    plugins: {
        "test-quality": { rules: { "meaningful-test": meaningfulTest } },
    },
    rules: {
        "test-quality/meaningful-test": "error",
        "no-unreachable": "error",
    },
}];
