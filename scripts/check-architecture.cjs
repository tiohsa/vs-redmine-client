const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isBuiltin } = require("node:module");
const ts = require("typescript");
const config = require("../architecture.config.json");

const root = path.resolve(__dirname, "..");
const relative = file => path.relative(root, file).split(path.sep).join("/");
const configPath = path.join(root, "tsconfig.json");
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: diagnostic => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  },
});
const program = ts.createProgram(parsed.fileNames, parsed.options);
const resolutionCache = ts.createModuleResolutionCache(root, name => name, parsed.options);
const baselinePath = path.join(root, "scripts/architecture-baseline.json");
const baseline = new Map(Object.entries(JSON.parse(fs.readFileSync(baselinePath, "utf8"))));
const legacy = new Map();
const recordLegacy = process.argv.includes("--record-legacy");
let violations = 0;

function location(file) {
  const [, layer, feature] = /^src\/layers\/([^/]+)\/(?:features\/([^/]+)\/)?/.exec(file) ?? [];
  return { layer, feature };
}

for (const input of program.getSourceFiles()) {
  const file = relative(input.fileName);
  if (!file.startsWith("src/") || file.startsWith("src/test/")) {
    continue;
  }
  const source = ts.createSourceFile(input.fileName, input.text, ts.ScriptTarget.Latest, true);
  const { layer, feature } = location(file);
  const core = file.startsWith("src/packages/framework-core/");
  const ratcheted = !layer && !file.startsWith("src/contracts/") && !core;
  function report(rule, start, detail, guidance) {
    const digest = createHash("sha256").update(detail).digest("hex").slice(0, 20);
    const key = `${file}:${rule}:${digest}`;
    if (ratcheted) {
      legacy.set(key, (legacy.get(key) ?? 0) + 1);
      if (legacy.get(key) <= (baseline.get(key) ?? 0)) {
        return;
      }
    }
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    fs.writeSync(2, `${file}:${line + 1}:${character + 1} [${rule}] ${guidance}\n`);
    violations++;
  }

  if (layer && !config.layers.includes(layer)) {
    report("runtime", 0, layer, "architecture.config.json に定義されたランタイムに配置してください。");
  }
  const comments = new Set();
  function checkComments(ranges) {
    for (const range of ranges ?? []) {
      if (comments.has(range.pos)) {
        continue;
      }
      comments.add(range.pos);
      const comment = source.text.slice(range.pos, range.end);
      const suppression = /eslint-(?:disable|enable|env)\b|^\/\*\s*eslint\s|@ts-(?:ignore|expect-error|nocheck)\b/.test(comment);
      report(suppression ? "suppression" : "comment", range.pos, comment, suppression
        ? "抑制を削除し、型・境界・API の違反を修正してください。"
        : "コメントを削除し、意図を識別子や型で表現してください。API の実装上の注記は packages/framework-core に置いてください。");
    }
  }
  function visit(node) {
    if (!core && !ts.isSourceFile(node)) {
      checkComments(ts.getLeadingCommentRanges(source.text, node.pos));
      checkComments(ts.getTrailingCommentRanges(source.text, node.end));
      if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent)) {
        const replacement = Object.hasOwn(config.restrictedApis, node.text) && config.restrictedApis[node.text];
        if (replacement) {
          report("restricted-api", node.getStart(source), node.text, `packages/framework-core の ${replacement} を使用してください。`);
        }
      }
    }
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isExternalModuleReference(node)) {
      specifier = node.expression;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require" ||
      ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "require"
    )) {
      specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) {
        report("dynamic-import", node.getStart(source), node.getText(source), "静的に解決できるモジュール名を指定してください。");
      }
    }
    if (specifier && ts.isStringLiteralLike(specifier)) {
      if (layer === "webview" && (specifier.text === "vscode" || isBuiltin(specifier.text))) {
        report("host-api-import", specifier.getStart(source), specifier.text,
          "VS Code と Node.js の API は extension-host で実行し、src/contracts のメッセージでやり取りしてください。");
      }
      const resolved = ts.resolveModuleName(specifier.text, source.fileName, parsed.options, ts.sys, resolutionCache).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport) {
        const target = relative(resolved.resolvedFileName);
        const destination = location(target);
        if (destination.layer && ((layer && layer !== destination.layer) || core || file.startsWith("src/contracts/"))) {
          report("layer-import", specifier.getStart(source), target, "ランタイム間の共有型とメッセージは src/contracts に置いてください。");
        }
        if (destination.feature && (layer !== destination.layer || feature !== destination.feature) &&
          !target.endsWith(`/features/${destination.feature}/index.ts`)) {
          report("feature-import", specifier.getStart(source), target, "対象 feature の公開 index.ts を import してください。");
        }
        if (layer && target.startsWith("src/") && !destination.layer &&
          !target.startsWith("src/contracts/") && !target.startsWith("src/packages/framework-core/")) {
          report("legacy-import", specifier.getStart(source), target, "依存を公開 feature、contracts、または packages/framework-core に配置してください。");
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (recordLegacy && !violations) {
  fs.writeFileSync(baselinePath, JSON.stringify(Object.fromEntries([...legacy].sort()), null, 2) + "\n");
}
if (!recordLegacy && [...baseline].some(([key, count]) => (legacy.get(key) ?? 0) < count)) {
  fs.writeSync(2, "解消済みの違反をベースラインから削除してください。node scripts/check-architecture.cjs --record-legacy\n");
  violations++;
}
process.exitCode = violations ? 1 : 0;
