import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../prototypes/integrated-backend/package.json', import.meta.url));
const ts = require(process.env.AERYNTH_CI_TYPESCRIPT ?? 'typescript');

const root = fileURLToPath(new URL('../', import.meta.url));
const renderer = 'prototypes/visual-experience/cinematic-v3/src/';
const backend = 'prototypes/integrated-backend/';
// These modules are native preload entry points even though they live in src/.
const preloads = new Set(['document-text-preload.ts', 'gpt-live-native-media.ts', 'wake-native-capture.ts'].map(name => renderer + name));
const files = prefix => execFileSync('git', ['ls-files', '-z', '--', prefix], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(file => /\.(?:[cm]?ts|[cm]?js)$/.test(file));

function dependencies(file) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../' + file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && !node.isTypeOnly && !node.importClause?.isTypeOnly) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports.map(specifier => specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier);
}

test('renderer runtime uses contracts and cannot import backend owners, native host or SQLite', () => {
  const sources = files(renderer);
  assert.ok(sources.length > 0);
  for (const file of sources) for (const dependency of dependencies(file)) {
    assert.ok(!dependency.startsWith(backend) || dependency === backend + 'src/mission-contracts.mts',
      `${file} crosses the renderer boundary into ${dependency}`);
    assert.doesNotMatch(dependency, /^node:|\/cinematic-v3\/native\//, file);
    assert.ok(dependency !== 'electron' || preloads.has(file), `${file} imports Electron outside a preload`);
  }
});

test('backend source does not depend on renderer implementation', () => {
  const sources = files(backend + 'src/');
  assert.ok(sources.length > 0);
  for (const file of sources) for (const dependency of dependencies(file)) {
    assert.ok(!dependency.startsWith(renderer), `${file} depends on the renderer via ${dependency}`);
  }
});
