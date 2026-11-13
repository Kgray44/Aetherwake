import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BLIND_INPUT_SHA256, readBlindInputs } from './blind-runner.mts';
import { validateNativeCieActivation, type NativeCieActivationScope } from './native-activation.mts';

test('native CIE preflight refuses absent or stale review and binds a bounded frozen selection', () => {
  const bytes = readFileSync(new URL('./cases.public.json', import.meta.url));
  const cases = readBlindInputs(bytes);
  const selected = [cases.find(item => item.sources.length)!, cases.find(item => !item.sources.length)!]
    .sort((a, b) => cases.indexOf(a) - cases.indexOf(b));
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const reviewed: NativeCieActivationScope = {
    candidate, inputSha256: BLIND_INPUT_SHA256, profileId: '12345678-1234-1234-1234-123456789012',
    configurationVersion: 2, catalogDigest: 'c'.repeat(64), provider: 'openai-api-vela',
    model: 'fixture-model', caseIds: selected.map(item => item.id), maxCalls: 7, expiresAt: 101,
  };
  const profile = { profileId: reviewed.profileId, configurationVersion: 2, usage: {
    enabled: true, configurationVersion: 2, maxOutputTokens: 2048, requestsPerDay: 64, usedToday: 57,
  } };
  const current = { candidate, profile,
    catalog: { configurationVersion: 2, digest: reviewed.catalogDigest, models: [reviewed.model] }, now: 100 };
  assert.throws(() => validateNativeCieActivation(bytes, null, current), /live_activation_required/u);
  assert.throws(() => validateNativeCieActivation(Buffer.from('changed'), reviewed, current), /seal_mismatch/u);
  assert.throws(() => validateNativeCieActivation(bytes, reviewed, { ...current, now: 101 }), /scope_changed/u);
  assert.throws(() => validateNativeCieActivation(bytes, reviewed, {
    ...current, candidate: { ...candidate, tree: 'd'.repeat(40) },
  }), /scope_changed/u);
  assert.throws(() => validateNativeCieActivation(bytes, reviewed, {
    ...current, profile: { ...profile, configurationVersion: 3 },
  }), /profile_changed/u);
  assert.throws(() => validateNativeCieActivation(bytes, reviewed, {
    ...current, catalog: { ...current.catalog, models: [] },
  }), /catalog_changed/u);
  assert.throws(() => validateNativeCieActivation(bytes, { ...reviewed, caseIds: [selected[0].id, selected[0].id] }, current),
    /cases_invalid/u);
  assert.throws(() => validateNativeCieActivation(bytes, { ...reviewed, maxCalls: 8 }, current), /budget_unavailable/u);
  assert.throws(() => validateNativeCieActivation(bytes, reviewed, {
    ...current, profile: { ...profile, usage: { ...profile.usage, usedToday: 58 } },
  }), /budget_unavailable/u);
  assert.deepEqual(validateNativeCieActivation(bytes, reviewed, current), { requiredCalls: 7, caseCount: 2 });
});
