import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { freshGraphics } = createRequire(import.meta.url)('../native/integration-product-ui.cjs');
const snapshot = { active: true, failed: false, contextLost: false, errors: [], draws: 20, frames: 20 };

test('native product capture accepts the actual controller error-array shape only after a fresh draw', () => {
  const next = { ...snapshot, draws: 21, frames: 21 };
  assert.equal(freshGraphics(snapshot, next), true);
  for (const change of [
    { errors: ['shader failed'] }, { errors: 0 }, { errors: undefined },
    { active: false }, { failed: true }, { contextLost: true },
    { draws: 20 }, { frames: 20 }, { frames: undefined }, { draws: NaN },
  ]) assert.equal(freshGraphics(snapshot, { ...next, ...change }), false, JSON.stringify(change));
  assert.equal(freshGraphics({ ...snapshot, errors: ['earlier failure'] }, next), false);
});
