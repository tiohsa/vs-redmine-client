import typescriptEslint from "typescript-eslint";

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
    files: ["src/test/**/*.test.ts"],
    linterOptions: {
        noInlineConfig: true,
    },
    rules: {
        "no-restricted-syntax": ["error", {
            selector: "MemberExpression[object.name=/^(test|it|specify|suite|describe|context)$/][property.name=/^(skip|only)$/], MemberExpression[object.name=/^(test|it|specify|suite|describe|context)$/][computed=true][property.value=/^(skip|only)$/], CallExpression[callee.object.type=ThisExpression]:matches([callee.property.name=skip], [callee.computed=true][callee.property.value=skip])",
            message: "テストの実行対象はランナーで選択してください。恒久的に実行しないテストは削除してください。",
        }, {
            selector: "CallExpression[callee.name=/^(test|it|specify|liveTest)$/][arguments.length<2], CallExpression[callee.name=/^(test|it|specify|liveTest)$/] > :matches(ArrowFunctionExpression, FunctionExpression):matches([body.type=BlockStatement][body.body.length=0], [body.type=Literal])",
            message: "テストには回帰を検出する処理を記述してください。空のテストは削除してください。",
        }, {
            selector: "CallExpression:matches([callee.name=assert], [callee.object.name=assert][callee.property.name=ok])[arguments.0.type=Literal][arguments.0.value=true]",
            message: "定数の代わりに、実際に観測した結果を検証してください。",
        }],
    },
}];
