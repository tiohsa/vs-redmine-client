const registrations = new Set(["test", "it", "specify", "suite", "describe", "context", "liveTest"]);
const selectionMethods = new Set(["skip", "only", "todo"]);
const equalityMethods = new Set(["equal", "strictEqual", "deepEqual", "deepStrictEqual"]);
const comparisonMethods = new Set([
    ...equalityMethods, "notEqual", "notStrictEqual", "notDeepEqual", "notDeepStrictEqual", "match", "doesNotMatch",
]);

const isCallback = node => node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";
const propertyName = (key, computed) => key.type === "Literal" ? key.value : computed ? undefined : key.name;
const memberName = node => node.type === "MemberExpression" ? propertyName(node.property, node.computed) : undefined;
const isNamedRegistration = node => node.type === "Identifier" && registrations.has(node.name);

export default {
    meta: {
        type: "problem",
        schema: [],
        messages: {
            empty: "実際の結果を検証する処理を追加してください。検証対象のないテストは削除してください。",
            selection: "テストの実行対象はランナーで選択してください。恒久的に実行しないテストは削除してください。",
            constant: "定数や同一値の比較の代わりに、検証対象から観測した結果を期待値と比較してください。",
        },
    },
    create(context) {
        const variableFor = identifier => {
            for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
                const variable = scope.set.get(identifier.name);
                if (variable) {
                    return variable;
                }
            }
        };
        const isTestContext = node => node.type === "Identifier" && variableFor(node)?.defs.some(def => {
            const callback = def.node;
            return def.type === "Parameter" && isCallback(callback) && callback.parent.type === "CallExpression" &&
                isRegistration(callback.parent.callee) && callback.parent.arguments.includes(callback);
        });
        const isRegistration = node => isNamedRegistration(node) ||
            memberName(node) === "test" && isTestContext(node.object);

        function isConstant(node, seen = new Set()) {
            switch (node?.type) {
            case "Literal":
                return !node.regex;
            case "TemplateLiteral":
                return node.expressions.every(value => isConstant(value, seen));
            case "UnaryExpression":
                return node.operator !== "delete" && isConstant(node.argument, seen);
            case "BinaryExpression":
            case "LogicalExpression":
                return isConstant(node.left, seen) && isConstant(node.right, seen);
            case "Identifier": {
                const def = variableFor(node)?.defs[0];
                if (!def) {
                    return node.name === "undefined";
                }
                if (def.type !== "Variable" || def.parent.kind !== "const" || def.node.id.type !== "Identifier" ||
                    seen.has(def.node)) {
                    return false;
                }
                return isConstant(def.node.init, new Set([...seen, def.node]));
            }
            default:
                return false;
            }
        }

        const isConstantData = node => isConstant(node) ||
            node?.type === "ArrayExpression" && node.elements.every(element => !element || isConstantData(element)) ||
            node?.type === "ObjectExpression" && node.properties.every(property =>
                property.type === "Property" && property.kind === "init" && !property.method &&
                (!property.computed || isConstant(property.key)) && isConstantData(property.value));

        function inertExpression(node) {
            if (!node || isConstantData(node)) {
                return true;
            }
            if (node.type === "AwaitExpression") {
                return inertExpression(node.argument);
            }
            if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
                return false;
            }
            const { callee, arguments: args } = node;
            const member = memberName(callee);
            return ((callee.object.name === "Promise" && member === "resolve") ||
                (callee.object.name === "console" && ["log", "info", "warn", "debug", "error"].includes(member))) &&
                args.every(inertExpression);
        }

        function inertBody(node) {
            switch (node.type) {
            case "BlockStatement":
                return node.body.every(inertBody);
            case "EmptyStatement":
                return true;
            case "ReturnStatement":
                return inertExpression(node.argument);
            case "ExpressionStatement":
                return inertExpression(node.expression);
            case "VariableDeclaration":
                return node.declarations.every(declaration =>
                    declaration.id.type === "Identifier" && inertExpression(declaration.init));
            default:
                return inertExpression(node);
            }
        }

        function isConstantAssertion(method, actual, expected) {
            if (method === "ok") {
                return isConstantData(actual) || isCallback(actual);
            }
            if (comparisonMethods.has(method)) {
                const comparesConstants = isConstantData(actual) && (isConstantData(expected) || !!expected?.regex);
                const comparesSameValue = equalityMethods.has(method) && actual?.type === "Identifier" &&
                    expected?.type === "Identifier" && actual.name === expected.name;
                return comparesConstants || comparesSameValue;
            }
            return ["doesNotThrow", "doesNotReject"].includes(method) && isCallback(actual) && inertBody(actual.body);
        }

        return {
            MemberExpression(node) {
                const member = memberName(node);
                if (selectionMethods.has(member) && isNamedRegistration(node.object) ||
                    (member === "skip" || member === "todo" || member === "runOnly") &&
                    (node.object.type === "ThisExpression" || isTestContext(node.object))) {
                    context.report({ node, messageId: "selection" });
                }
            },
            CallExpression(node) {
                const { callee, arguments: args } = node;
                if (isRegistration(callee)) {
                    const callback = args.find(isCallback);
                    const last = args.at(-1);
                    const hasNamedCallback = args.length >= (callee.name === "liveTest" ? 3 : 2) &&
                        ["Identifier", "MemberExpression", "CallExpression"].includes(last?.type) && last.name !== "undefined";
                    if (callback ? inertBody(callback.body) : !hasNamedCallback) {
                        context.report({ node: callback ?? node, messageId: "empty" });
                    }
                    for (const option of args.filter(arg => arg.type === "ObjectExpression").flatMap(arg => arg.properties)) {
                        if (option.type === "Property" && selectionMethods.has(propertyName(option.key, option.computed)) &&
                            !(option.value.type === "Literal" && option.value.value === false)) {
                            context.report({ node: option, messageId: "selection" });
                        }
                    }
                }

                const assertion = callee.type === "Identifier" && callee.name === "assert" ? "ok" :
                    callee.type === "MemberExpression" && callee.object.name === "assert" ? memberName(callee) : undefined;
                if (isConstantAssertion(assertion, args[0], args[1])) {
                    context.report({ node, messageId: "constant" });
                }
            },
        };
    },
};
