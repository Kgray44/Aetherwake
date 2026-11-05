import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VELA_IDENTITY_CONTRACT, VELA_IDENTITY_PROMPT, VELA_IDENTITY_PROMPT_BYTES,
  VELA_IDENTITY_VERSION, renderVelaIdentityPrompt,
} from '../src/vela-identity.mts';

test('the versioned identity retains the canonical assistant and explicit evidence classes', () => {
  const contract = VELA_IDENTITY_CONTRACT;
  assert.equal(VELA_IDENTITY_VERSION, 'aerynth.vela-identity@2');
  assert.equal(contract.version, VELA_IDENTITY_VERSION);
  assert.equal(contract.assistantId, 'system:vela');
  assert.equal(contract.name, 'Vela');
  assert.equal(contract.role, 'application-assistant');
  assert.deepEqual(contract.evidenceClasses, ['observed', 'reported', 'inferred', 'unknown']);
  assert.equal(Reflect.set(contract, 'assistantId', 'provider-session'), false);
  assert.equal(Reflect.set(contract.instructions, 'authority', 'Expand access'), false);
  assert.equal(Reflect.set(contract.evidenceClasses, '0', 'verified'), false);
});

test('every shared prompt retains the complete behavior contract within its explicit byte budget', () => {
  const rules = VELA_IDENTITY_CONTRACT.instructions;
  assert.deepEqual(Object.keys(rules).sort(), ['authority', 'awareness', 'continuity', 'evidence', 'execution', 'personality', 'recovery']);
  const prompt = renderVelaIdentityPrompt();
  assert.equal(prompt, VELA_IDENTITY_PROMPT);
  assert.equal(renderVelaIdentityPrompt(), prompt);
  assert.equal(prompt.split('\n')[0], VELA_IDENTITY_VERSION);
  for (const instruction of Object.values(rules)) {
    assert.ok(instruction.trim().length > 0);
    assert.equal(prompt.split(instruction).length - 1, 1, 'each required instruction is rendered exactly once');
  }
  assert.equal(VELA_IDENTITY_PROMPT_BYTES, Buffer.byteLength(prompt, 'utf8'));
  assert.ok(VELA_IDENTITY_PROMPT_BYTES <= 2048, 'shared identity must fit the 2 KiB instruction allowance');
});

test('executor rendering retains shared continuity and authority while preserving the Codex role', () => {
  const assistant = renderVelaIdentityPrompt('assistant');
  const executor = renderVelaIdentityPrompt('codex-executor');
  assert.notEqual(executor, assistant);
  assert.match(assistant.split('\n')[1], /Speak as Vela/);
  assert.match(executor.split('\n')[1], /Codex.*native engineering instructions.*executor identity/);
  assert.doesNotMatch(executor, /Speak as Vela|You are Vela/);
  assert.deepEqual(executor.split('\n').slice(2), assistant.split('\n').slice(2));
  assert.ok(Buffer.byteLength(executor, 'utf8') <= 2048);
});
