import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const module of ['./workspace-native.cjs', './library-native.cjs']) {
  test(module + ' captures actual Electron 45 first-details signature including source identity', () => {
    const { consoleHandler } = require(module), emitter = new EventEmitter(), receipt: any = { errors: [] };
    emitter.on('console-message', consoleHandler(receipt));
    emitter.emit('console-message', { level: 'error', message: 'Synthetic actual-signature error', sourceId: 'http://127.0.0.1/src/actual-source.ts', lineNumber: 17 }, 3, 'Deprecated argument must not be used', 999, 'deprecated-source');
    assert.deepEqual(receipt.errors, ['Synthetic actual-signature error']);
    assert.deepEqual(receipt.consoleErrors, [{ message: 'Synthetic actual-signature error', sourceId: 'http://127.0.0.1/src/actual-source.ts', lineNumber: 17 }]);
    emitter.emit('console-message', { level: 'warning', message: 'Warning is not an error', sourceId: 'warning-source', lineNumber: 18 }, 2);
    assert.equal(receipt.errors.length, 1);
  });
}
test('native console diagnostics retain bounded error text/source records rather than unbounded renderer output', () => {
  const { consoleErrorHandler } = require('./native-console.cjs'), receipt: any = { errors: [] }, handler = consoleErrorHandler(receipt);
  for (let n = 0; n < 25; n++) handler({ level: 'error', message: 'x'.repeat(2000), sourceId: 'y'.repeat(2000), lineNumber: n });
  assert.equal(receipt.errors.length, 20); assert.equal(receipt.consoleErrors.length, 20);
  assert.ok(receipt.consoleErrors.every((record: any) => record.message.length === 1000 && record.sourceId.length === 1000));
});
