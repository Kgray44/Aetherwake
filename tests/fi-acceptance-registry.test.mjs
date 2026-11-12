import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryPath, validateFiRegistry } from '../scripts/validate-fi-acceptance-registry.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const load = () => JSON.parse(readFileSync(resolve(root, registryPath), 'utf8'));
test('registry covers all 108 authoritative scenario rows with valid local evidence paths', () => {
  const result = validateFiRegistry(load(), root);
  assert.deepEqual(result, { valid: true, errors: [], requirements: 108 });
});
test('missing, duplicate, unknown and moved definitions cannot silently drift', () => {
  for (const change of [r => r.requirements.pop(), r => r.requirements.push(r.requirements[0]),
    r => r.requirements[0].id = 'FI-ACC-99', r => r.requirements[0].definition.line++]) {
    const registry = load(); change(registry); assert.equal(validateFiRegistry(registry, root).valid, false);
  }
});
test('invalid evidence, layers and invented acceptance are rejected', () => {
  for (const change of [r => r.evidenceSets.cognition.testFiles = ['missing.test.mts'],
    r => r.evidenceSets.cognition.evidenceArtifacts = ['/tmp/untrusted'],
    r => r.evidenceSets.cognition.requiredLayers = ['D4'],
    r => r.requirements[0].acceptance = 'passed',
    r => r.evidenceSets.cognition.latestResult.status = 'passed',
    r => r.requirements[0].evidenceSet = 'invented']) {
    const registry = load(); change(registry); assert.equal(validateFiRegistry(registry, root).valid, false);
  }
});
