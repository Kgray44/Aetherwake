import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PersonalContextService } from '../src/service.mts';
import type { ContextRequest, FactDraft, OriginalImport, OriginalInput, PersonalContextHost, PersonalCrypto, PersonalScope } from '../src/contracts.ts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';

const ordinary: PersonalScope = { kind: 'assistant.ordinary' }, vela: PersonalScope = { kind: 'assistant.vela' }, shared: PersonalScope = { kind: 'user.shared' };
const original = (patch: Partial<OriginalInput> = {}): OriginalInput => ({ source: 'user-paste', kind: 'memories', scope: ordinary, text: 'Synthetic user prefers concise engineering explanations.', sensitive: false, expiresAt: null, ...patch });
const fact = (source?: OriginalImport, patch: Partial<FactDraft> = {}): FactDraft => ({ scope: ordinary, purpose: 'knowledge', category: 'technical', text: 'Synthetic fictional hardware is a fictional processor.', keywords: ['hardware', 'processor'], certainty: 'explicit-statement', sensitive: false, expiresAt: null, source: source ? { kind: 'import', id: source.id, version: source.version, start: 0, end: source.text.length } : { kind: 'user-statement' }, ...patch });
const request = (patch: Partial<ContextRequest> = {}): ContextRequest => ({ requestId: 'synthetic:request', assistant: 'ordinary', providerId: 'synthetic:provider', query: 'Which hardware processor?', projectId: null, conversationId: null, sharedFactIds: [], includeBehavior: true, maxBytes: 16384, maxItems: 8, ...patch });

test('encrypted online backup preserves correction provenance and enforces current disclosure after restore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-personal-context-backup-'));
  const sourcePath = join(dir, 'canonical.sqlite'), copyPath = join(dir, 'backup.sqlite');
  const key = randomBytes(32);
  let kernel: WorkspaceKernel | undefined;
  let writer: ReturnType<typeof fixture> | undefined;
  let restored: ReturnType<typeof fixture> | undefined;
  let wrongKey: ReturnType<typeof fixture> | undefined;
  try {
    kernel = WorkspaceKernel.open(sourcePath);
    writer = fixture(sourcePath, key);
    writer.enable();
    const source = writer.service.importOriginal(original());
    const previous = writer.service.reviewFact(fact(source));
    const { replacement } = writer.service.correctFact({
      id: previous.id, expectedVersion: previous.version,
      replacement: fact(source, { scope: { kind: 'project', id: 'p1' }, text: 'Synthetic corrected hardware processor.' }),
    });
    const input = request({ projectId: 'p1' });
    const preview = writer.service.previewContext(input);
    assert.deepEqual(preview.items.map(item => item.factId), [replacement.id]);
    await kernel.backupTo(copyPath);
    const bytes = readFileSync(copyPath);
    for (const text of [source.text, previous.text, replacement.text]) {
      assert(!bytes.includes(Buffer.from(text)));
    }
    assert(!bytes.includes(key));
    const removed = writer.service.hardDelete({ id: source.id, expectedVersion: source.version });
    assert(removed.deleted.some(record => record.id === replacement.id));
    assert.throws(() => writer!.service.readFact(replacement.id), /personal_record_unavailable/);
    writer.close();
    writer = undefined;
    kernel.close();
    kernel = undefined;

    restored = fixture(copyPath, key);
    assert.deepEqual(restored.service.readImport(source.id), source);
    assert.deepEqual(restored.service.readFact(replacement.id), replacement);
    assert.equal(restored.service.readFact(previous.id).supersededBy, replacement.id);
    assert.equal(restored.service.validateContext(preview, input).context.digest, preview.digest);
    const newDestination = { ...input, providerId: 'synthetic:other-provider' };
    assert.throws(() => restored!.service.validateContext(preview, newDestination), /stale_personal_context/);
    const rebound = restored.service.previewContext(newDestination);
    assert.deepEqual(rebound.items, preview.items);
    assert.equal(restored.service.validateContext(rebound, newDestination).context.digest, rebound.digest);
    restored.scopes.set('project:p1', '2');
    assert.throws(() => restored!.service.validateContext(rebound, newDestination), /stale_personal_scope/);
    restored.scopes.set('project:p1', '1');
    restored.denied.add('context.disclose');
    assert.throws(() => restored!.service.validateContext(preview, input), /personal_context_not_authorized/);
    restored.close();
    restored = undefined;

    wrongKey = fixture(copyPath);
    assert.throws(() => wrongKey!.service.readFact(replacement.id), /private_content_unavailable/);
  } finally {
    wrongKey?.close();
    restored?.close();
    writer?.close();
    kernel?.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert(basename(dir).startsWith('aerynth-personal-context-backup-'));
    rmSync(dir, { recursive: true, force: true });
  }
});

/** All contents, users and scopes are synthetic. AES-GCM fixture key lives ONLY in test memory, never SQLite/Git. */
function fixture(file = ':memory:', key = randomBytes(32)) {
  const db = new DatabaseSync(file); db.exec('CREATE TABLE IF NOT EXISTS synthetic_canonical_resources(id TEXT PRIMARY KEY); INSERT OR IGNORE INTO synthetic_canonical_resources VALUES(\'synthetic:existing-resource\')');
  let serial = 0, available = true, owner = 'synthetic:owner', policyVersion = 'synthetic:policy1', clock = '2026-11-02T12:00:00.000Z', failEncryptionAt = Infinity;
  const calls = { encrypted: 0, decrypted: 0, authorizations: [] as string[] }, denied = new Set<string>(), scopes = new Map<string, string>([['project:p1', '1'], ['project:p2', '1'], ['conversation:c1', '7']]);
  const transaction = <T,>(work: (value: DatabaseSync) => T): T => { const name = 'pc_' + serial++; db.exec('SAVEPOINT ' + name); try { const value = work(db); db.exec('RELEASE ' + name); return value; } catch (error) { db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); throw error; } };
  const crypto: PersonalCrypto = {
    available: () => available,
    encrypt: (value, purpose) => { calls.encrypted++; if (calls.encrypted === failEncryptionAt) throw Error('Synthetic encryption failure'); const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(purpose)); const encrypted = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]); },
    decrypt: (value, purpose) => { calls.decrypted++; const bytes = Buffer.from(value), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]); },
  };
  const host: PersonalContextHost = {
    identity: () => ({ userId: owner, policyVersion }),
    resolveScope: value => { const version = value.kind === 'project' || value.kind === 'conversation' ? scopes.get(value.kind + ':' + value.id) : 'logical1'; return version ? { scope: value, version } : null; },
    authorize: input => { calls.authorizations.push(input.operation); return denied.has(input.operation) || denied.has(JSON.stringify(input.scope)) ? { decision: 'deny' } : { decision: 'allow', policyVersion, authorizationRef: 'synthetic:grant:' + input.operation }; },
  };
  const options = { db, transaction, readTransaction: transaction, host, crypto, now: () => clock }; let service = new PersonalContextService(options);
  return { db, calls, scopes, denied, host, key, options, get service() { return service; },
    enable: () => service.setPolicy({ expectedVersion: 0, patch: { storageEnabled: true, ordinaryEnabled: true, velaEnabled: true, sharingEnabled: true, sensitiveEnabled: true } }),
    lock: () => { available = false; }, owner: (value: string) => { owner = value; }, policyVersion: (value: string) => { policyVersion = value; }, clock: (value: string) => { clock = value; },
    failEncryption: (offset = 1) => { failEncryptionAt = calls.encrypted + offset; }, restart: () => { service = new PersonalContextService(options); },
    counts: () => ({ heads: db.prepare('SELECT count(*) AS n FROM personal_context_heads').get()!.n, revisions: db.prepare('SELECT count(*) AS n FROM personal_context_revisions').get()!.n, dependencies: db.prepare('SELECT count(*) AS n FROM personal_context_dependencies').get()!.n }),
    close: () => db.close(),
  };
}

test('privacy defaults off, same canonical connection preserved, no provider or automatic import/review exists', () => {
  const f = fixture(); try { assert.deepEqual(f.service.policy(), { version: 0, storageEnabled: false, ordinaryEnabled: false, velaEnabled: false, sharingEnabled: false, sensitiveEnabled: false }); assert.throws(() => f.service.importOriginal(original()), /personal_storage_disabled/); assert.equal(f.service.previewContext(request()).items.length, 0); assert.equal(f.counts().heads, 0); assert.equal(f.db.prepare('SELECT count(*) AS n FROM synthetic_canonical_resources').get()!.n, 1); } finally { f.close(); }
});

test('exact original text retains every revision; importing several sections never creates or approves facts', () => {
  const f = fixture(); try { f.enable(); const text = '  Synthetic instructions\r\n\nDo not rewrite this. \ud800 ', first = f.service.importOriginal(original({ kind: 'behavior', text })), second = f.service.importOriginal(original({ text: 'Another synthetic section.' })); assert.equal(f.service.readImport(first.id).text, text); const edited = f.service.editImport({ id: first.id, expectedVersion: 1, replacement: original({ kind: 'behavior', text: 'Synthetic replacement' }) }); assert.equal(edited.version, 2); assert.equal(f.service.readImport(first.id, 1).text, text); assert.equal(f.service.readImport(second.id).text, 'Another synthetic section.'); assert.equal(f.db.prepare("SELECT count(*) AS n FROM personal_context_heads WHERE kind='fact'").get()!.n, 0); assert.equal(f.service.previewContext(request()).items.length, 0); } finally { f.close(); }
});

test('reviewed facts retain provenance/uncertainty, relevant whole items only, no raw import or irrelevant history disclosure', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original({ text: 'Synthetic import includes private unrelated prose and hardware background.' })), useful = f.service.reviewFact(fact(source, { certainty: 'inference' })); f.service.reviewFact(fact(source, { text: 'Synthetic photography preference', keywords: ['photography'] })); const changes = f.db.prepare('SELECT total_changes() AS n').get()!.n, context = f.service.previewContext(request()); assert.equal(context.items.length, 1); assert.equal(context.items[0].factId, useful.id); assert.equal(context.items[0].certainty, 'inference'); assert.equal(context.trust, 'untrusted-personalization-data'); assert(!JSON.stringify(context).includes(source.text)); assert(context.omissions.some(item => item.reason === 'irrelevant')); assert.equal(context.encodedBytes, Buffer.byteLength(JSON.stringify(context))); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes); assert.equal(f.service.validateContext(context, request()).authorizationRef, 'synthetic:grant:context.disclose'); } finally { f.close(); }
});

test('ordinary behavioral profile never crosses into Vela, while shared facts need individual opt-in and policy', () => {
  const f = fixture(); try { f.enable(); const profile = f.service.importOriginal(original({ kind: 'behavior', text: 'Synthetic ordinary humor instruction' })); const behavior = f.service.reviewFact(fact(profile, { purpose: 'behavior', category: 'preferences', text: 'Synthetic ordinary humor', keywords: ['style'] })); const knowledge = f.service.reviewFact(fact(undefined, { scope: shared })); assert.throws(() => f.service.reviewFact(fact(profile, { scope: vela, purpose: 'behavior' })), /behavior_profile_isolation/); assert.throws(() => f.service.reviewFact(fact(profile, { scope: shared, purpose: 'knowledge' })), /behavior_profile_isolation/); const own = f.service.reviewFact(fact(undefined, { scope: vela, purpose: 'behavior', text: 'Synthetic Vela identity remains separate.' })); const ordinaryContext = f.service.previewContext(request()); assert(ordinaryContext.items.some(item => item.factId === behavior.id)); assert(!ordinaryContext.items.some(item => item.factId === knowledge.id || item.factId === own.id)); const input = request({ assistant: 'vela', sharedFactIds: [knowledge.id] }), velaContext = f.service.previewContext(input); assert.deepEqual(new Set(velaContext.items.map(item => item.factId)), new Set([knowledge.id, own.id])); assert(!JSON.stringify(velaContext).includes(behavior.text)); f.service.setPolicy({ expectedVersion: 1, patch: { sharingEnabled: false } }); assert(!f.service.previewContext(input).items.some(item => item.factId === knowledge.id)); } finally { f.close(); }
});

test('canonical project/conversation scope matches exact current IDs and versions; unknown IDs fail before content reads', () => {
  const f = fixture(); try { f.enable(); const a = f.service.reviewFact(fact(undefined, { scope: { kind: 'project', id: 'p1' } })), b = f.service.reviewFact(fact(undefined, { scope: { kind: 'conversation', id: 'c1' } })); assert.equal(f.service.previewContext(request()).items.length, 0); const input = request({ projectId: 'p1', conversationId: 'c1' }), context = f.service.previewContext(input); assert.deepEqual(new Set(context.items.map(item => item.factId)), new Set([a.id, b.id])); f.scopes.set('project:p1', '2'); assert.throws(() => f.service.validateContext(context, input), /stale_personal_scope/); const reads = f.calls.decrypted; assert.throws(() => f.service.reviewFact(fact(undefined, { scope: { kind: 'project', id: 'noncanonical' } })), /canonical_scope_unavailable/); assert(f.calls.decrypted - reads <= 1, 'only privacy policy, no private fact body'); assert.throws(() => f.service.previewContext(request({ projectId: 'noncanonical' })), /canonical_scope_unavailable/); } finally { f.close(); }
});

test('CAS edits and explicit corrections preserve history, supersede without silent merging, and concurrent services use canonical versions', () => {
  const f = fixture(); try { f.enable(); const old = f.service.reviewFact(fact()), second = new PersonalContextService(f.options); const edited = second.editFact({ id: old.id, expectedVersion: 1, replacement: fact(undefined, { text: 'Synthetic corrected processor.' }) }); assert.equal(edited.version, 2); assert.throws(() => f.service.editFact({ id: old.id, expectedVersion: 1, replacement: fact() }), /stale_personal_context_version/); assert.equal(f.service.readFact(old.id, 1).text, old.text); const replacement = f.service.correctFact({ id: old.id, expectedVersion: 2, replacement: fact(undefined, { certainty: 'conflicting', text: 'Synthetic competing evidence, unresolved.' }) }); assert.equal(replacement.previous.state, 'superseded'); assert.equal(replacement.previous.supersededBy, replacement.replacement.id); const context = f.service.previewContext(request()); assert.deepEqual(context.items.map(item => item.factId), [replacement.replacement.id]); assert.equal(context.items[0].certainty, 'conflicting'); } finally { f.close(); }
});

test('revoked and superseded facts cannot be reactivated through an edit or correction', () => {
  const f = fixture();
  try {
    f.enable();
    const revoked = f.service.reviewFact(fact());
    const previous = f.service.reviewFact(fact());
    const { replacement } = f.service.correctFact({ id: previous.id, expectedVersion: previous.version,
      replacement: fact(undefined, { text: 'Synthetic replacement processor.' }) });
    f.service.revoke({ id: revoked.id, expectedVersion: revoked.version });
    f.restart();
    const before = f.counts();
    for (const prior of [revoked, previous]) {
      const input = { id: prior.id, expectedVersion: prior.version + 1, replacement: fact() };
      assert.throws(() => f.service.editFact(input), /personal_fact_inactive/);
      assert.throws(() => f.service.correctFact(input), /personal_fact_inactive/);
    }
    assert.deepEqual(f.counts(), before);
    assert.deepEqual(f.service.previewContext(request()).items.map(item => item.factId), [replacement.id]);
  } finally { f.close(); }
});

test('changed import, revoked source/fact, expiration and policy changes invalidate exact previously previewed context', () => {
  for (const change of ['import', 'revoke-source', 'revoke-fact', 'expire', 'policy', 'host-policy'] as const) { const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()), value = f.service.reviewFact(fact(source, { expiresAt: '2026-11-02T13:00:00.000Z' })), input = request(), context = f.service.previewContext(input); assert.equal(context.items.length, 1);
    if (change === 'import') f.service.editImport({ id: source.id, expectedVersion: 1, replacement: original({ text: 'Synthetic changed source' }) });
    if (change === 'revoke-source') f.service.revoke({ id: source.id, expectedVersion: 1 }); if (change === 'revoke-fact') f.service.revoke({ id: value.id, expectedVersion: 1 }); if (change === 'expire') f.clock('2026-11-02T13:00:00.000Z'); if (change === 'policy') f.service.setPolicy({ expectedVersion: 1, patch: { ordinaryEnabled: false } }); if (change === 'host-policy') f.policyVersion('synthetic:policy2');
    assert.throws(() => f.service.validateContext(context, input)); assert.equal(f.service.previewContext(input).items.length, change === 'host-policy' ? 1 : 0, 'a new host policy needs new review; it does not itself delete authorized facts'); } finally { f.close(); } }
});

test('the inspectable metadata index is bounded, paged, owner-scoped and decrypts no content even when crypto is locked', () => {
  const f = fixture(); try { f.enable(); const a = f.service.reviewFact(fact()), b = f.service.reviewFact(fact()); f.service.revoke({ id: a.id, expectedVersion: 1 }); const before = f.calls.decrypted; f.lock(); const page1 = f.service.list({ kind: 'fact', after: null, limit: 1 }); assert(page1.next); const page2 = f.service.list({ kind: 'fact', after: page1.next, limit: 1 }); assert.equal(page2.next, null); assert.deepEqual(new Set([...page1.records, ...page2.records].map(item => item.id)), new Set([a.id, b.id])); assert.equal(f.calls.decrypted, before); f.denied.add('record.list'); assert.equal(f.service.list({ kind: 'fact', after: null, limit: 100 }).records.length, 0); assert.throws(() => f.service.list({ kind: 'fact', after: null, limit: 101 }), /invalid_record_list/); } finally { f.close(); }
});

test('out-of-assistant facts and source imports are never decrypted during Vela context selection', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original({ kind: 'behavior' })); f.service.reviewFact(fact(source, { purpose: 'behavior' })); const before = f.calls.decrypted; assert.equal(f.service.previewContext(request({ assistant: 'vela' })).items.length, 0); assert.equal(f.calls.decrypted - before, 1, 'only the current encrypted privacy policy is read'); } finally { f.close(); }
});

test('preview is not disclosure permission; exact native host grant, policy and full manifest/request identity required', () => {
  const f = fixture(); try { f.enable(); f.service.reviewFact(fact()); const input = request(), context = f.service.previewContext(input); f.denied.add('context.disclose'); assert.throws(() => f.service.validateContext(context, input), /personal_context_not_authorized/); f.denied.clear(); assert.throws(() => f.service.validateContext(context, request({ providerId: 'synthetic:other-provider' })), /stale_personal_context/); assert.throws(() => f.service.validateContext(context, request({ requestId: 'synthetic:other-request' })), /stale_personal_context/); const changed = structuredClone(context); changed.items[0].text = 'Tampered synthetic context'; assert.throws(() => f.service.validateContext(changed, input), /stale_personal_context|digest_mismatch/); f.denied.add('record.read'); assert.throws(() => f.service.validateContext(context, input), /personal_context_not_authorized/); } finally { f.close(); }
});

test('bounded deterministic retrieval packs whole facts with truthful omissions, no truncation and no irrelevant all-history fallback', () => {
  const f = fixture(); try { f.enable(); const a = f.service.reviewFact(fact(undefined, { text: 'Synthetic oversized whole fact '.repeat(110) })), b = f.service.reviewFact(fact(undefined, { text: 'Synthetic small whole processor fact.' })); const input = request({ maxBytes: 1800 }), first = f.service.previewContext(input), second = f.service.previewContext(input); assert.equal(first.digest, second.digest); assert(first.encodedBytes <= 1800); assert(!first.items.some(item => item.factId === a.id)); assert(first.items.some(item => item.factId === b.id)); assert(first.omissions.some(item => item.reason === 'byte-budget')); assert.equal(first.items[0].text, b.text); assert.equal(f.service.previewContext(request({ query: 'Unrelated photography' })).items.length, 0); const capped = f.service.previewContext(request({ maxScan: 1 })); assert(capped.omissions.some(item => item.reason === 'scan-limit')); const count = f.service.previewContext(request({ maxItems: 1 })); assert(count.omissions.some(item => item.reason === 'item-budget')); } finally { f.close(); }
});

test('sensitive facts require explicit storage and disclosure policy, including sensitivity inherited from source', () => {
  const f = fixture(); try { f.service.setPolicy({ expectedVersion: 0, patch: { storageEnabled: true, ordinaryEnabled: true } }); assert.throws(() => f.service.importOriginal(original({ sensitive: true })), /personal_storage_disabled/); f.service.setPolicy({ expectedVersion: 1, patch: { sensitiveEnabled: true } }); const source = f.service.importOriginal(original({ sensitive: true })); assert.throws(() => f.service.reviewFact(fact(source)), /sensitive_source_requires_sensitive_fact/); f.service.reviewFact(fact(source, { sensitive: true })); assert.equal(f.service.previewContext(request()).items.length, 1); f.service.setPolicy({ expectedVersion: 2, patch: { sensitiveEnabled: false } }); assert.equal(f.service.previewContext(request()).items.length, 0); } finally { f.close(); }
});

test('crypto unavailable fails closed and swapped ciphertext cannot impersonate a fact or revision', () => {
  const f = fixture(); try { f.enable(); const a = f.service.reviewFact(fact()), b = f.service.reviewFact(fact(undefined, { text: 'Different synthetic plaintext' })); const cipher = f.db.prepare('SELECT cipher FROM personal_context_revisions WHERE id=?').get(a.id)!.cipher; f.db.prepare('UPDATE personal_context_revisions SET cipher=? WHERE id=?').run(cipher, b.id); assert.throws(() => f.service.readFact(b.id), /private_content_unavailable/); const before = f.counts(); f.lock(); assert.throws(() => f.service.readFact(a.id), /private_crypto_unavailable/); assert.throws(() => f.service.importOriginal(original()), /private_crypto_unavailable/); assert.throws(() => f.service.previewContext(request()), /private_crypto_unavailable/); assert.deepEqual(f.counts(), before); } finally { f.close(); }
});

test('an encryption failure during correction rolls back both records and all provenance indices', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()), old = f.service.reviewFact(fact(source)), before = f.counts(); f.failEncryption(2); assert.throws(() => f.service.correctFact({ id: old.id, expectedVersion: 1, replacement: fact(source) }), /private_encryption_failed/); assert.deepEqual(f.counts(), before); assert.equal(f.service.readFact(old.id).state, 'active'); assert.equal(f.service.readFact(old.id).version, 1); } finally { f.close(); }
});

test('hard deletion removes ALL encrypted original/dependent revisions and proof indices; old manifests cannot dispatch', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()), value = f.service.reviewFact(fact(source)), input = request(), context = f.service.previewContext(input); f.service.editFact({ id: value.id, expectedVersion: 1, replacement: fact(undefined) }); f.service.editImport({ id: source.id, expectedVersion: 1, replacement: original({ text: 'New synthetic original' }) }); assert.equal(f.counts().dependencies, 1); const deleted = f.service.hardDelete({ id: source.id, expectedVersion: 2 }); assert.deepEqual(new Set(deleted.deleted.map(ref => ref.id)), new Set([source.id, value.id])); assert.equal(f.counts().heads, 1); assert.equal(f.counts().revisions, 1); assert.equal(f.counts().dependencies, 0); assert.throws(() => f.service.readImport(source.id), /personal_record_unavailable/); assert.throws(() => f.service.validateContext(context, input)); assert.equal(f.service.previewContext(input).items.length, 0); } finally { f.close(); }
});

test('export is explicit, bounded and preserves exact originals and revisions; no file/network effects or restored review authority', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()), value = f.service.reviewFact(fact(source)); f.service.editImport({ id: source.id, expectedVersion: 1, replacement: original({ text: 'Synthetic revision two' }) }); const bundle = f.service.export({ ids: [source.id, value.id], maxBytes: 16384 }); assert.equal(bundle.records[0].revisions.length, 2); assert.equal((bundle.records[0].revisions[0] as OriginalImport).text, source.text); assert.throws(() => f.service.export({ ids: [source.id], maxBytes: 10 }), /export_budget_exceeded/); f.denied.add('record.export'); assert.throws(() => f.service.export({ ids: [source.id], maxBytes: 16384 }), /personal_context_not_authorized/); f.denied.clear(); const reimport = f.service.importOriginal(original({ source: 'user-export', text: JSON.stringify(bundle) })); assert.equal(f.service.readImport(reimport.id).text, JSON.stringify(bundle)); assert.equal(f.db.prepare("SELECT count(*) AS n FROM personal_context_heads WHERE kind='fact'").get()!.n, 1, 'reimport never creates approved facts'); } finally { f.close(); }
});

test('historical revision scope access is checked before its plaintext is decrypted', () => {
  const f = fixture(); try { f.enable(); const value = f.service.reviewFact(fact(undefined, { scope: { kind: 'project', id: 'p1' } })); f.service.editFact({ id: value.id, expectedVersion: 1, replacement: fact(undefined, { scope: { kind: 'project', id: 'p2' } }) }); f.scopes.delete('project:p1'); const before = f.calls.decrypted; assert.throws(() => f.service.readFact(value.id, 1), /canonical_scope_unavailable/); assert.equal(f.calls.decrypted, before); assert.equal(f.service.readFact(value.id).scope.kind, 'project'); } finally { f.close(); }
});

test('restart preserves exact IDs/content/provenance/policy, SQLite has no private plaintext, and owner boundaries remain separate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-personal-context-')), file = join(dir, 'canonical.sqlite'), key = randomBytes(32); let f = fixture(file, key);
  try { f.enable(); const source = f.service.importOriginal(original()), value = f.service.reviewFact(fact(source)), input = request(), context = f.service.previewContext(input); f.close(); assert(!readFileSync(file).includes(Buffer.from(source.text))); assert(!readFileSync(file).includes(Buffer.from(value.text))); f = fixture(file, key); assert.deepEqual(f.service.readImport(source.id), source); assert.deepEqual(f.service.readFact(value.id), value); assert.equal(f.service.validateContext(context, input).context.digest, context.digest); f.owner('synthetic:other-owner'); assert.equal(f.service.policy().version, 0); assert.throws(() => f.service.readFact(value.id), /personal_record_unavailable/); assert.equal(f.service.previewContext(input).items.length, 0); } finally { f.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert(basename(dir).startsWith('aerynth-personal-context-')); rmSync(dir, { recursive: true, force: true }); }
});

test('schema1 creation is idempotent; unknown schema fails closed without touching canonical rows, connection mismatch rejects', () => {
  const f = fixture(), wrong = new DatabaseSync(':memory:'); try { const before = f.counts(); f.restart(); assert.deepEqual(f.counts(), before); f.db.prepare('UPDATE personal_context_schema SET version=99').run(); assert.throws(() => f.restart(), /unsupported_personal_context_schema/); assert.equal(f.db.prepare('SELECT version FROM personal_context_schema').get()!.version, 99); assert.equal(f.db.prepare('SELECT count(*) AS n FROM synthetic_canonical_resources').get()!.n, 1); assert.throws(() => new PersonalContextService({ ...f.options, transaction: work => work(wrong) }), /canonical_database_connection_mismatch/); } finally { wrong.close(); f.close(); }
});

test('malformed/oversized private data, behavior sharing and unbounded budgets reject without partial storage', () => {
  const f = fixture(); try { f.enable(); const before = f.counts();
    for (const value of [original({ text: 'x'.repeat(256 * 1024 + 1) }), original({ kind: 'behavior', scope: shared }), { ...original(), automaticApproval: true }]) assert.throws(() => f.service.importOriginal(value as OriginalInput));
    for (const value of [fact(undefined, { text: 'x'.repeat(4097) }), fact(undefined, { scope: shared, purpose: 'behavior' }), fact(undefined, { keywords: ['duplicate', 'duplicate'] }), fact(undefined, { certainty: 'confirmed-by-model' as any })]) assert.throws(() => f.service.reviewFact(value));
    assert.throws(() => f.service.setPolicy({ expectedVersion: 1, patch: { ordinaryEnabled: 'yes' as any } }), /invalid_privacy_policy/);
    assert.throws(() => f.service.previewContext(request({ maxBytes: Infinity })), /invalid_context_budget/); assert.throws(() => f.service.previewContext(request({ maxScan: 513 })), /invalid_context_budget/);
    assert.deepEqual(f.counts(), before);
  } finally { f.close(); }
});

test('scope denial skips the original body; shared reviewed knowledge never grants access to its underlying import', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()), value = f.service.reviewFact(fact(source, { scope: shared })); const before = f.calls.decrypted; f.denied.add(JSON.stringify(ordinary)); const context = f.service.previewContext(request({ assistant: 'vela', sharedFactIds: [value.id] })); assert.equal(context.items.length, 0); assert(context.omissions.some(item => item.reason === 'unavailable')); assert.equal(f.calls.decrypted - before, 2, 'only privacy policy and selected fact, never denied original body'); } finally { f.close(); }
});

test('a current project decision gets scanned before old facts regardless of its ID', () => {
  const f = fixture();
  try {
    f.enable();
    const scope = { kind: 'project', id: 'p1' } as const;
    const records = Array.from({ length: 12 }, () => f.service.reviewFact(fact(undefined, { scope })));
    const laterId = records.sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
    const updated = f.service.editFact({ id: laterId.id, expectedVersion: laterId.version,
      replacement: fact(undefined, { scope, text: 'Current synthetic project decision.', keywords: ['quartz'] }) });
    f.restart();
    const preview = f.service.previewContext(request({ projectId: 'p1', query: 'Which quartz?', maxScan: 1 }));
    assert.deepEqual(preview.items.map(item => [item.factId, item.version]), [[updated.id, updated.version]]);
    assert.deepEqual(preview.omissions, [{ reason: 'scan-limit', count: 11 }]);
  } finally { f.close(); }
});

test('exact source anchors recall a project fact without keyword overlap and cannot cross scope', () => {
  const f = fixture();
  try {
    f.enable();
    const anchor = { kind: 'conversation-message', conversationId: 'c1', messageId: 'm1' } as const;
    const source = { ...anchor, version: '1', contentDigest: 'a'.repeat(64) };
    const proof = { ...source, projectId: 'p1', role: 'user' as const, sensitive: false };
    let present = true;
    const service = new PersonalContextService({ ...f.options, host: { ...f.host, resolveConversationSource: () => present ? proof : null } });
    const value = service.reviewFact(fact(undefined, { source, scope: { kind: 'project', id: 'p1' } }));
    for (let index = 0; index < 16; index++) service.reviewFact(fact(undefined, { scope: { kind: 'project', id: 'p1' } }));
    const input = request({ projectId: 'p1', query: 'What did we settle on?', maxScan: 1 });
    assert.deepEqual(service.previewContext(input).items, []);
    const anchored = { ...input, sourceAnchors: [anchor] };
    const preview = service.previewContext(anchored);
    assert.deepEqual(preview.items.map(item => item.factId), [value.id]);
    assert.throws(() => service.validateContext(preview, input), /stale_personal_context/);
    assert.throws(() => service.previewContext({ ...anchored, sourceAnchors: [anchor, anchor] }), /invalid_context_request/);
    assert.deepEqual(service.previewContext({ ...anchored, projectId: 'p2' }).items, []);
    present = false;
    assert.throws(() => service.validateContext(preview, anchored), /stale_personal_context/);
    assert.deepEqual(service.previewContext(anchored).items, []);
  } finally { f.close(); }
});

test('reviewed conversation memory travels within its project and stops recalling a removed source', () => {
  const f = fixture();
  try {
    f.enable();
    const scope = { kind: 'project', id: 'p1' } as const;
    let present = true;
    const source = { kind: 'conversation-message', conversationId: 'c1', messageId: 'm1', version: 'message:1', contentDigest: 'a'.repeat(64) } as const;
    const { kind: _kind, ...reference } = source;
    const message = { ...reference, projectId: 'p1', role: 'user' as const, sensitive: false };
    const host: PersonalContextHost = { ...f.host, resolveConversationSource: () => present ? message : null };
    const memory = new PersonalContextService({ ...f.options, host });
    const saved = memory.reviewFact(fact(undefined, { scope, source }));
    assert.equal(saved.provenance.kind, 'conversation-message');
    const query = request({ projectId: 'p1' });
    const context = memory.previewContext(query);
    assert.deepEqual(context.items.map(item => item.factId), [saved.id]);
    assert.equal(memory.previewContext(request({ projectId: 'p2' })).items.length, 0);
    assert.throws(() => memory.reviewFact(fact(undefined, { source, scope: { kind: 'project', id: 'p2' } })), /conversation_source_scope_mismatch/);
    message.contentDigest = 'b'.repeat(64);
    assert.throws(() => memory.reviewFact(fact(undefined, { source, scope })), /stale_conversation_source/);
    assert.throws(() => memory.validateContext(context, query), /stale_personal_context/);
    present = false;
    assert.throws(() => memory.validateContext(context, query), /stale_personal_context/);
    assert.equal(memory.previewContext(query).items.length, 0);
    assert.throws(() => memory.readFact(saved.id), /conversation_source_unavailable/);
    assert.throws(() => memory.correctFact({ id: saved.id, expectedVersion: 1, replacement: fact() }), /conversation_source_unavailable/);
    assert.throws(() => memory.export({ ids: [saved.id], maxBytes: 8192 }), /conversation_source_unavailable/);
    const revised = memory.editFact({ id: saved.id, expectedVersion: saved.version, replacement: fact(undefined, { scope }) });
    const independent = memory.reviewFact(fact(undefined, { scope }));
    const sourceRef = { kind: 'conversation-message', conversationId: 'c1', messageId: 'm1' } as const;
    f.denied.add('source.erase');
    assert.throws(() => memory.eraseConversationSource(sourceRef), /personal_context_not_authorized/);
    f.denied.delete('source.erase');
    f.denied.add('record.delete');
    assert.throws(() => memory.eraseConversationSource(sourceRef), /personal_context_not_authorized/);
    assert.equal(memory.readFact(saved.id).version, revised.version);
    f.denied.delete('record.delete');
    f.options.transaction(() => {
      assert.throws(() => f.options.transaction(() => {
        memory.eraseConversationSource(sourceRef);
        throw Error('source owner rollback');
      }), /source owner rollback/);
      assert.equal(memory.readFact(saved.id).version, revised.version);
    });
    const decrypted = f.calls.decrypted;
    f.lock();
    assert.deepEqual(memory.eraseConversationSource(sourceRef).deleted.map(value => value.id), [saved.id]);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM personal_context_revisions WHERE id=?').get(saved.id)?.n, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM personal_context_revisions WHERE id=?').get(independent.id)?.n, 1);
    assert.equal(f.calls.decrypted, decrypted);
    assert.deepEqual(memory.eraseConversationSource(sourceRef).deleted, []);
  } finally { f.close(); }
});

test('erasing a conversation source removes corrections that inherited its memory lineage', () => {
  const f = fixture();
  try {
    f.enable();
    const source = { kind: 'conversation-message', conversationId: 'c1', messageId: 'm1', version: '1', contentDigest: 'a'.repeat(64) } as const;
    const scope = { kind: 'project', id: 'p1' } as const;
    const host: PersonalContextHost = { ...f.host, resolveConversationSource: () => ({ ...source,
      role: 'user', sensitive: false, projectId: scope.id }) };
    const memory = new PersonalContextService({ ...f.options, host });
    const first = memory.reviewFact(fact(undefined, { scope, source }));
    const { replacement: second } = memory.correctFact({ id: first.id, expectedVersion: first.version, replacement: fact(undefined, { scope }) });
    const { replacement: third } = memory.correctFact({ id: second.id, expectedVersion: second.version, replacement: fact(undefined, { scope }) });
    const independent = memory.reviewFact(fact(undefined, { scope }));
    const anchor = { kind: source.kind, conversationId: source.conversationId, messageId: source.messageId };
    const anchored = memory.previewContext(request({ projectId: scope.id, query: 'What was agreed?', sourceAnchors: [anchor] }));
    assert.deepEqual(anchored.items, []);
    const query = request({ projectId: scope.id });
    const preview = memory.previewContext(query);
    assert.ok(preview.items.some(item => item.factId === third.id));
    f.denied.add('record.delete');
    assert.throws(() => memory.eraseConversationSource(anchor), /personal_context_not_authorized/);
    assert.doesNotThrow(() => memory.validateContext(preview, query));
    f.denied.delete('record.delete');
    f.lock();
    assert.deepEqual(new Set(memory.eraseConversationSource(anchor).deleted.map(row => row.id)), new Set([first.id, second.id, third.id]));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM personal_context_revisions WHERE id=?').get(independent.id)?.n, 1);
  } finally { f.close(); }
});

test('deletion requires every dependent host authorization and can remove encrypted data while the key is unavailable', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()), value = f.service.reviewFact(fact(source, { scope: shared })), before = f.counts(); f.denied.add(JSON.stringify(shared)); assert.throws(() => f.service.hardDelete({ id: source.id, expectedVersion: 1 }), /personal_context_not_authorized/); assert.deepEqual(f.counts(), before); f.denied.clear(); f.lock(); assert.deepEqual(new Set(f.service.hardDelete({ id: source.id, expectedVersion: 1 }).deleted.map(item => item.id)), new Set([source.id, value.id])); assert.equal(f.counts().revisions, 1); } finally { f.close(); }
});

test('repeated reviewed facts reuse one bounded source read, and revision capacity fails without eviction', () => {
  const f = fixture(); try { f.enable(); const source = f.service.importOriginal(original()); f.service.reviewFact(fact(source)); const value = f.service.reviewFact(fact(source)); const before = f.calls.decrypted; assert.equal(f.service.previewContext(request()).items.length, 2); assert.equal(f.calls.decrypted - before, 4, 'one policy, two facts and one original source'); let current = value; for (let n = 1; n < 128; n++) current = f.service.editFact({ id: current.id, expectedVersion: current.version, replacement: fact(source) }); const counts = f.counts(); assert.equal(current.version, 128); assert.throws(() => f.service.editFact({ id: current.id, expectedVersion: current.version, replacement: fact(source) }), /personal_context_capacity_reached/); assert.deepEqual(f.counts(), counts); assert.equal(f.service.readFact(value.id, 1).text, value.text); } finally { f.close(); }
});

test('unknown encrypted envelope versions reject without resetting retained data, and read transactions cannot switch databases', () => {
  const f = fixture(), wrong = new DatabaseSync(':memory:'); try { f.enable(); const value = f.service.reviewFact(fact()), purpose = 'aerynth.personal-context/1:' + JSON.stringify(['synthetic:owner', value.id, 1]), row = f.db.prepare('SELECT cipher FROM personal_context_revisions WHERE id=?').get(value.id)!, envelope = JSON.parse(new TextDecoder().decode(f.options.crypto.decrypt(row.cipher as Uint8Array, purpose))); envelope.schemaVersion = 99; const cipher = f.options.crypto.encrypt(new TextEncoder().encode(JSON.stringify(envelope)), purpose); f.db.prepare('UPDATE personal_context_revisions SET cipher=? WHERE id=?').run(cipher, value.id); const before = f.counts(); assert.throws(() => f.service.readFact(value.id), /private_content_binding_mismatch/); f.restart(); assert.deepEqual(f.counts(), before); const service = new PersonalContextService({ ...f.options, readTransaction: work => work(wrong) }); assert.throws(() => service.policy(), /canonical_database_connection_mismatch/); } finally { wrong.close(); f.close(); }
});
