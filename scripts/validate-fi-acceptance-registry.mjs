#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const registryPath = 'docs/engineering/FI-ACCEPTANCE-REGISTRY.json';
export const sourcePaths = [
  'docs/specifications/VELA-FLUID-INTELLIGENCE-ACCEPTANCE.md',
  'governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md',
  'governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md',
  'governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md',
  'governance/10-AI-EXECUTION-PROFILER.md',
];
export function validateFiRegistry(registry, root) {
  const errors = [];
  const expected = new Map();
  for (const path of sourcePaths) {
    readFileSync(resolve(root, path), 'utf8').split(/\r?\n/u).forEach((line, index) => {
      const id = /^\|\s*(?:\*\*)?((?:FI-ACC-|FI-QA-|OBS-FI-|PLT-ARIE-|AEP-T)\d+)/u.exec(line)?.[1];
      if (id) expected.set(id, { path, line: index + 1 });
    });
  }
  const validPath = path => typeof path === 'string' && !isAbsolute(path) &&
    !relative(root, resolve(root, path)).startsWith('..') && existsSync(resolve(root, path));
  if (registry?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(registry?.sourceRevision ?? '')) errors.push('invalid registry identity');
  if (!Array.isArray(registry?.requirements) || !registry?.evidenceSets || typeof registry.evidenceSets !== 'object') {
    return { valid: false, errors: [...errors, 'invalid registry shape'], requirements: 0 };
  }
  const seen = new Set();
  for (const record of registry.requirements) {
    if (seen.has(record.id)) errors.push(`duplicate ID: ${record.id}`);
    seen.add(record.id);
    const source = expected.get(record.id);
    if (!source || record.definition?.path !== source.path || record.definition?.line !== source.line) errors.push(`definition mismatch: ${record.id}`);
    const set = registry.evidenceSets[record.evidenceSet];
    if (!set) errors.push(`missing evidence set: ${record.id}`);
    if (!['related-witnesses-only', 'not-established'].includes(record.coverage)) errors.push(`invalid coverage: ${record.id}`);
    // This inventory does not carry approval records and must not manufacture acceptance.
    if (record.acceptance !== 'not-adjudicated') errors.push(`unsupported acceptance claim: ${record.id}`);
    if (record.coverage === 'related-witnesses-only' && !set?.testFiles?.length) errors.push(`witness missing: ${record.id}`);
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`missing ID: ${id}`);
  for (const [name, set] of Object.entries(registry.evidenceSets)) {
    for (const field of ['owner', 'phase', 'implementation', 'nativeDevice', 'deferredScope']) {
      if (typeof set[field] !== 'string' || !set[field].trim()) errors.push(`missing ${field}: ${name}`);
    }
    if (set.requiredLayers !== null && (!Array.isArray(set.requiredLayers) || !set.requiredLayers.length ||
        set.requiredLayers.some(layer => !['D0', 'D1', 'D2', 'D3'].includes(layer)))) errors.push(`invalid layers: ${name}`);
    if (!Array.isArray(set.testFiles) || set.testFiles.some(path => !validPath(path) || !/\.test\.[mc]?[jt]s$/u.test(path))) errors.push(`invalid fixture path: ${name}`);
    if (!Array.isArray(set.evidenceArtifacts) || !set.evidenceArtifacts.length || set.evidenceArtifacts.some(path => !validPath(path))) errors.push(`invalid evidence path: ${name}`);
    if (!Array.isArray(set.evidenceKinds) || set.evidenceKinds.some(kind => !['synthetic', 'published-native', 'published-live-provider'].includes(kind))) errors.push(`invalid evidence class: ${name}`);
    if (!['documented-scoped-evidence', 'not-established'].includes(set.latestResult?.status) || !set.latestResult?.scope) errors.push(`invalid result: ${name}`);
  }
  return { valid: errors.length === 0, errors, requirements: expected.size };
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateFiRegistry(JSON.parse(readFileSync(resolve(root, registryPath), 'utf8')), root);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}
