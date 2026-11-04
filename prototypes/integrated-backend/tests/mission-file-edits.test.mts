import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mediaSourceRevision } from '../src/media-sources.mts';
import { MissionFileEdits, type ApiFileProposalProvenance, type MissionFileEditsHost, type MissionEditScope,
  type NativeSelectedCodeFile } from '../src/mission-file-edits.mts';
import type { MissionFileEditOwner } from '../../application-contract/mission-file-edits.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const before = 'export const add = (a, b) => a - b;\n';
const after = 'export const add = (a, b) => a + b;\n';
const tap = 'TAP version 13\nok 1 - addition\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
const owner: MissionFileEditOwner = { kind: 'api-mission', missionId: 'mission-1', taskId: 'edit-1', attemptId: 'attempt-1', planRevision: 1 };

/** Actual selected tracked files and SQLite CAS; synthetic completed API evidence,
 * native decisions and restricted-runner receipts. No inference, GUI or test-code execution. */
function fixture() {
  const parent = resolve(homedir(), 'Documents', 'Aerynth Validation'), dir = join(parent, 'mfe-' + randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'source.mjs'), testPath = join(dir, 'source.test.mjs');
  writeFileSync(path, before);
  writeFileSync(testPath, "import test from 'node:test'; import assert from 'node:assert/strict'; import {add} from './source.mjs'; test('addition',()=>assert.equal(add(2,3),5));\n");
  const git = (args: string[]) => execFileSync('git.exe', ['-C', dir, ...args], { windowsHide: true, timeout: 5000, maxBuffer: 32768, stdio: 'pipe' });
  git(['init', '-q']); git(['add', '--', 'source.mjs', 'source.test.mjs']);
  git(['-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic selected-file fixture']);
  const db = new DatabaseSync(':memory:');
  let clock = Date.now(), readActive = true, ownerActive = true, busy = false, calls = 0, rebind: 'normal' | 'throw' | 'fake' = 'normal';
  let runnerReady = true, failWriteJournal = false;
  let scope: MissionEditScope = { principalId: 'principal-1', policyVersion: 'policy-01', projectId: 'project-1', workspaceId: 'workspace-1', stamp: 'scope-1' };
  let execute: NonNullable<MissionFileEditsHost['verifier']>['execute'] = async () => ({ exitCode: 0, stdout: tap, stderr: '' });
  const retained = new Map<string, { release(): void; completion: Promise<'exit-observed' | 'unknown'> }>();
  const grant = { id: 'read-grant-1', version: 1, purpose: 'selected-file-read' as const, expiresAt: clock + 3600000 };
  const atomic = <T,>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      if (failWriteJournal && db.prepare("SELECT id FROM mission_file_operations WHERE json_extract(json,'$.phase')='applying'").get()) throw Error('synthetic journal failure');
      db.exec('COMMIT'); return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  atomic(() => {
    MissionFileEdits.migrate(db);
    // Minimal canonical host fixture: versions come from the SQLite CAS, never the domain.
    db.exec(`CREATE TABLE resources(id TEXT PRIMARY KEY,version INTEGER NOT NULL,source_revision TEXT NOT NULL,path TEXT NOT NULL);
      CREATE TABLE api_evidence(id TEXT PRIMARY KEY,proof TEXT NOT NULL,owner TEXT NOT NULL);
      CREATE TABLE native_choices(id TEXT PRIMARY KEY,review_id TEXT NOT NULL,digest TEXT NOT NULL,purpose TEXT NOT NULL,choice TEXT NOT NULL);`);
    db.prepare('INSERT INTO resources VALUES(?,?,?,?)').run('file-1', 1, mediaSourceRevision(lstatSync(path, { bigint: true })), path);
  });
  const selected = (resourceId: string): NativeSelectedCodeFile | null => {
    const row = db.prepare('SELECT * FROM resources WHERE id=?').get(resourceId);
    return row ? { resourceId: String(row.id), version: Number(row.version), sourceRevision: String(row.source_revision), path: String(row.path), readAuthority: { ...grant } } : null;
  };
  const host: MissionFileEditsHost = {
    db, atomic, now: () => clock, scope: () => ({ ...scope }), ownerCurrent: () => ownerActive, selected,
    readAuthorityCurrent: (authority, resourceId) => readActive && resourceId === 'file-1' && JSON.stringify(authority) === JSON.stringify(grant),
    apiProvenanceCurrent: (proof, expectedOwner) => {
      const row = db.prepare('SELECT * FROM api_evidence WHERE id=?').get(proof.evidenceId);
      return row?.proof === JSON.stringify(proof) && row.owner === JSON.stringify(expectedOwner);
    },
    consumeNativeChoice(input) {
      const row = db.prepare('SELECT * FROM native_choices WHERE id=?').get(input.choiceId);
      if (!row || row.review_id !== input.reviewId || row.digest !== input.reviewDigest || row.purpose !== input.purpose) return undefined;
      db.prepare('DELETE FROM native_choices WHERE id=?').run(input.choiceId); return row.choice as 'yes' | 'no';
    },
    rebindSource(input) {
      assert.ok(db.isTransaction);
      if (rebind === 'throw') throw Error('synthetic canonical commit failure');
      const revision = mediaSourceRevision(lstatSync(path, { bigint: true }));
      if (rebind === 'fake') return { resourceId: 'file-1', version: input.expected.version + 1, sourceRevision: revision };
      assert.equal(sha(readFileSync(path, 'utf8')), input.afterDigest);
      const changed = db.prepare('UPDATE resources SET version=version+1,source_revision=? WHERE id=? AND version=? AND source_revision=? AND path=?')
        .run(revision, input.expected.resourceId, input.expected.version, input.expected.sourceRevision, input.expected.path).changes;
      const row = selected('file-1');
      return changed === 1 && row ? { resourceId: row.resourceId, version: row.version, sourceRevision: row.sourceRevision } : null;
    },
    lease(root) { assert.equal(root.toLowerCase(), dir.toLowerCase()); if (busy) return null; busy = true; return () => { busy = false; }; },
    retainUnknownCheck(input) {
      retained.set(input.operationId, input);
      void input.completion.then(state => { if (state === 'exit-observed') { input.release(); retained.delete(input.operationId); } });
    },
    verifier: { ready: async () => runnerReady, execute: async (argv, cwd) => { calls++; assert.equal(cwd.toLowerCase(), dir.toLowerCase());
      assert.deepEqual(argv.slice(1), ['--test', '--test-isolation=none', '--test-reporter=tap', '--', './source.test.mjs']); return execute(argv, cwd); } },
  };
  let domain = new MissionFileEdits(host);
  const inspect = (chosenOwner = owner) => domain.inspect({ resourceId: 'file-1', expectedVersion: selected('file-1')!.version, owner: chosenOwner });
  const proposal = (inspection = inspect(), replacement = after) => {
    const output = JSON.stringify({ summary: 'Correct addition in the selected file', files: [{ path: inspection.source.relativePath, replacement }] });
    const proof: ApiFileProposalProvenance = { providerId: 'openai-api-vela', executionId: 'execution-' + randomUUID(), responseId: 'response-' + randomUUID(),
      evidenceId: 'evidence-' + randomUUID(), expectedModel: 'fixture-model', reportedModel: 'fixture-model', inspectionDigest: inspection.inspectionDigest, outputDigest: sha(output) };
    db.prepare('INSERT INTO api_evidence VALUES(?,?,?)').run(proof.evidenceId, JSON.stringify(proof), JSON.stringify(inspection.owner));
    return { inspection, output, proof, view: domain.propose({ inspectionId: inspection.inspectionId, provenance: proof, output }) };
  };
  const decision = (review: { reviewId: string; reviewDigest: string }, purpose: 'patch' | 'check', choice: 'yes' | 'no' = 'yes') => {
    const id = randomUUID(); db.prepare('INSERT INTO native_choices VALUES(?,?,?,?,?)').run(id, review.reviewId, review.reviewDigest, purpose, choice); return id;
  };
  const approve = (operationId: string) => { const review = domain.review(operationId); return domain.acceptNativePatchChoice(operationId, review.reviewId, decision(review, 'patch'))!; };
  const apply = () => { const op = proposal().view, authority = approve(op.id); return domain.apply(op.id, authority.authority); };
  const check = (operationId: string) => { const review = domain.reviewRequiredCheck(operationId, testPath); return domain.acceptNativeCheckChoice(operationId, review.reviewId, decision(review, 'check'))!; };
  return {
    dir, path, testPath, db, host, selected, inspect, proposal, decision, approve, apply, check,
    get domain() { return domain; }, get calls() { return calls; }, get busy() { return busy; },
    get retained() { return retained.size; },
    set readActive(value: boolean) { readActive = value; }, set ownerActive(value: boolean) { ownerActive = value; },
    set scope(value: MissionEditScope) { scope = value; }, get scope() { return { ...scope }; },
    set rebind(value: typeof rebind) { rebind = value; }, set runnerReady(value: boolean) { runnerReady = value; },
    set execute(value: typeof execute) { execute = value; }, set failWriteJournal(value: boolean) { failWriteJournal = value; },
    advance(ms: number) { clock += ms; },
    reopen() { domain = new MissionFileEdits(host); },
    raw(operationId: string) { return JSON.parse(String(db.prepare('SELECT json FROM mission_file_operations WHERE id=?').get(operationId)!.json)); },
    async close() {
      await domain.close();
      // Fixture transports have no real child. This explicit fixture-owned stop
      // is cleanup only; it is never used to assert a production cancellation ack.
      for (const item of retained.values()) item.release(); retained.clear(); db.close();
      const part = relative(parent, resolve(dir)); assert.ok(part.startsWith('mfe-') && !part.startsWith('..') && !isAbsolute(part));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('typed native inspection and canonical API proof produce a private proposal with an explicit safe approval barrier', async () => {
  const f = fixture(); try {
    const inspection = f.inspect(); assert.equal(inspection.source.content, before); assert.equal(inspection.source.resourceId, 'file-1');
    assert.ok(!JSON.stringify(inspection).includes(f.dir)); assert.doesNotMatch(JSON.stringify(inspection), /read-grant/);
    const p = f.proposal(inspection), view = p.view;
    assert.equal(view.phase, 'awaiting-native-review'); assert.deepEqual(view.barrier, { kind: 'native-patch-review', operationId: view.id, patchDigest: view.patchDigest });
    assert.equal(view.verification.state, 'not-run'); assert.equal(view.source.version, 1);
    assert.ok(!JSON.stringify(view).includes(f.dir)); assert.doesNotMatch(JSON.stringify(view), /read-grant|export const|sourceRevision|beforeDigest/);
    assert.throws(() => f.domain.propose({ inspectionId: inspection.inspectionId, provenance: p.proof, output: p.output }), /inspection_consumed/);
    assert.throws(() => f.domain.apply(view.id, 'read-grant-1'), /write_authority_required/);
    const review = f.domain.review(view.id); assert.equal(review.path, f.path); assert.equal(review.before, before); assert.equal(review.after, after);
    assert.throws(() => f.domain.acceptNativePatchChoice(view.id, review.reviewId, 'read-grant-1'), /native_choice_required/);
    assert.equal(readFileSync(f.path, 'utf8'), before); assert.equal(f.calls, 0);
  } finally { await f.close(); }
});

test('API evidence cannot be forged, rebound to changed output or reused across selected-file inspections', async () => {
  const f = fixture(); try {
    const p = f.proposal();
    for (const provenance of [{ ...p.proof, providerId: 'codex-app-server' }, { ...p.proof, reportedModel: 'other-model' }, { ...p.proof, evidenceId: 'invented' }])
      assert.throws(() => f.domain.propose({ inspectionId: p.inspection.inspectionId, provenance: provenance as ApiFileProposalProvenance, output: p.output }), /api_provenance_required/);
    assert.throws(() => f.domain.propose({ inspectionId: p.inspection.inspectionId, provenance: p.proof, output: p.output + ' ' }), /api_provenance_required/);
    const another = f.inspect(); assert.throws(() => f.domain.propose({ inspectionId: another.inspectionId, provenance: p.proof, output: p.output }), /api_provenance_required/);
    assert.throws(() => f.inspect({ kind: 'api-selected-file-intent', requestId: 'C:\\private.txt' }), /invalid_mission_edit/);
    assert.throws(() => f.inspect({ ...owner, extra: f.path } as MissionFileEditOwner), /invalid_mission_edit/);
    assert.equal(readFileSync(f.path, 'utf8'), before);
  } finally { await f.close(); }
});

test('native No and stale exact-review IDs grant no write; a new review requires a new matching native decision', async () => {
  const f = fixture(); try {
    const op = f.proposal().view, old = f.domain.review(op.id), latest = f.domain.review(op.id);
    assert.throws(() => f.domain.acceptNativePatchChoice(op.id, old.reviewId, f.decision(old, 'patch')), /native_choice_required/);
    assert.throws(() => f.domain.acceptNativePatchChoice(op.id, latest.reviewId, f.decision(old, 'patch')), /native_choice_required/);
    assert.equal(f.domain.acceptNativePatchChoice(op.id, latest.reviewId, f.decision(latest, 'patch', 'no')), null);
    assert.equal(f.domain.view(op.id).phase, 'cancelled'); assert.equal(readFileSync(f.path, 'utf8'), before);
    assert.equal(Number(f.db.prepare('SELECT count(*) AS n FROM mission_file_authorities').get()!.n), 0);
  } finally { await f.close(); }
});

test('actual safe staged replacement consumes a distinct authority once and rebinds the same canonical resource by CAS', async () => {
  const f = fixture(); try {
    const op = f.proposal().view, authority = f.approve(op.id);
    assert.notEqual(authority.authority, 'read-grant-1');
    assert.throws(() => f.domain.apply(op.id, 'read-grant-1'), /write_authority_required/); assert.equal(readFileSync(f.path, 'utf8'), before);
    const applied = f.domain.apply(op.id, authority.authority);
    assert.equal(applied.phase, 'applied'); assert.deepEqual(applied.source, { resourceId: 'file-1', version: 2 });
    assert.equal(readFileSync(f.path, 'utf8'), after); assert.equal(applied.verification.state, 'not-run'); assert.equal(f.calls, 0);
    assert.equal(f.selected('file-1')!.sourceRevision, mediaSourceRevision(lstatSync(f.path, { bigint: true })));
    assert.equal(f.db.prepare('SELECT state FROM mission_file_authorities').get()!.state, 'consumed');
    assert.equal(readFileSync(f.raw(op.id).file.backupPath, 'utf8'), before);
    assert.throws(() => f.domain.apply(op.id, authority.authority), /write_authority_required/); assert.equal(f.busy, false);
  } finally { await f.close(); }
});

test('version CAS, byte identity, revoked read grant, changed owner/policy and expiry fence review/apply without side effects', async () => {
  for (const fault of ['version', 'bytes', 'revoked', 'owner', 'policy', 'expired'] as const) {
    const f = fixture(); try {
      const op = f.proposal().view, authority = f.approve(op.id);
      if (fault === 'version') f.db.prepare('UPDATE resources SET version=version+1').run();
      if (fault === 'bytes') writeFileSync(f.path, before + '// external change\n');
      if (fault === 'revoked') f.readActive = false;
      if (fault === 'owner') f.ownerActive = false;
      if (fault === 'policy') f.scope = { ...f.scope, policyVersion: 'policy-1' };
      if (fault === 'expired') f.advance(180001);
      const actual = readFileSync(f.path, 'utf8');
      assert.throws(() => f.domain.apply(op.id, authority.authority), /source_changed|scope_changed|inspection_expired/);
      assert.equal(readFileSync(f.path, 'utf8'), actual); assert.equal(f.raw(op.id).phase, 'approved'); assert.equal(f.calls, 0); assert.equal(f.busy, false);
    } finally { await f.close(); }
  }
});

test('initial write journal failure fails closed before filesystem publication and releases the shared checkout lease', async () => {
  const f = fixture(); try {
    const op = f.proposal().view, authority = f.approve(op.id); f.failWriteJournal = true;
    assert.throws(() => f.domain.apply(op.id, authority.authority), /synthetic journal failure/);
    assert.equal(readFileSync(f.path, 'utf8'), before); assert.equal(f.selected('file-1')!.version, 1); assert.equal(f.raw(op.id).phase, 'approved');
    assert.equal(f.db.prepare('SELECT state FROM mission_file_authorities').get()!.state, 'active'); assert.equal(f.busy, false);
  } finally { await f.close(); }
});

test('post-write canonical failure is unknown with preserved backup; restart and observation reconcile without replay', async () => {
  const f = fixture(); try {
    const op = f.proposal().view, authority = f.approve(op.id); f.rebind = 'throw';
    assert.equal(f.domain.apply(op.id, authority.authority).phase, 'unknown');
    assert.equal(readFileSync(f.path, 'utf8'), after); assert.equal(f.selected('file-1')!.version, 1);
    const backup = f.raw(op.id).file.backupPath; assert.equal(readFileSync(backup, 'utf8'), before);
    f.reopen(); assert.equal(f.domain.view(op.id).phase, 'unknown');
    assert.throws(() => f.domain.apply(op.id, authority.authority), /write_authority_required/);
    f.rebind = 'normal'; assert.equal(f.domain.reconcile(op.id).phase, 'applied');
    assert.equal(f.selected('file-1')!.version, 2); assert.equal(readFileSync(backup, 'utf8'), before); assert.equal(f.calls, 0);
  } finally { await f.close(); }
});

test('a fabricated canonical version cannot convert a confirmed filesystem write into an applied canonical edit', async () => {
  const f = fixture(); try {
    const op = f.proposal().view, authority = f.approve(op.id); f.rebind = 'fake';
    const view = f.domain.apply(op.id, authority.authority);
    assert.equal(view.phase, 'unknown'); assert.equal(view.source.version, 1); assert.equal(f.selected('file-1')!.version, 1);
    assert.equal(readFileSync(f.path, 'utf8'), after); assert.equal(f.raw(op.id).afterSource, undefined);
  } finally { await f.close(); }
});

test('restart invalidates pending write authority, preserves truthful applying/check uncertainty and does not fill terminal journals', async () => {
  const f = fixture(); try {
    const op = f.proposal().view, authority = f.approve(op.id); f.reopen();
    assert.equal(f.domain.view(op.id).phase, 'awaiting-native-review');
    assert.equal(f.db.prepare('SELECT state FROM mission_file_authorities').get()!.state, 'revoked');
    assert.throws(() => f.domain.apply(op.id, authority.authority), /write_authority_required/);
    const reviewed = f.approve(op.id); f.domain.apply(op.id, reviewed.authority);
    const raw = f.raw(op.id); raw.phase = 'applying'; raw.check = { state: 'running' };
    f.db.prepare('UPDATE mission_file_operations SET json=? WHERE id=?').run(JSON.stringify(raw), op.id);
    f.reopen(); assert.equal(f.raw(op.id).phase, 'unknown'); assert.equal(f.raw(op.id).check.state, 'unknown');
    const count = f.raw(op.id).events.length; for (let i = 0; i < 40; i++) f.reopen();
    assert.equal(f.raw(op.id).events.length, count); assert.equal(readFileSync(f.path, 'utf8'), after); assert.equal(f.calls, 0);
  } finally { await f.close(); }
});

test('compensation is a separate exact patch with another native Yes and a new canonical version', async () => {
  const f = fixture(); try {
    const applied = f.apply(), undo = f.domain.prepareCompensation(applied.id);
    assert.equal(undo.compensationOf, applied.id); assert.equal(undo.phase, 'awaiting-native-review');
    assert.equal(readFileSync(f.path, 'utf8'), after);
    assert.throws(() => f.domain.apply(undo.id, 'read-grant-1'), /write_authority_required/);
    const authority = f.approve(undo.id), reverted = f.domain.apply(undo.id, authority.authority);
    assert.equal(reverted.phase, 'applied'); assert.equal(reverted.source.resourceId, applied.source.resourceId); assert.equal(reverted.source.version, 3);
    assert.equal(readFileSync(f.path, 'utf8'), before); assert.equal(f.domain.view(applied.id).phase, 'compensated');
    assert.ok(existsSync(f.raw(applied.id).file.backupPath)); assert.ok(existsSync(f.raw(undo.id).file.backupPath));
  } finally { await f.close(); }
});

test('required verification uses only the reviewed restricted runner and a separate native one-use check authority', async () => {
  const f = fixture(); try {
    const applied = f.apply(), review = f.domain.reviewRequiredCheck(applied.id, f.testPath);
    assert.equal(f.calls, 0); assert.equal(f.domain.view(applied.id).verification.state, 'awaiting-native-review');
    assert.equal(f.domain.view(applied.id).barrier?.kind, 'native-check-review');
    await assert.rejects(f.domain.runRequiredCheck(applied.id, 'read-grant-1'), /check_unavailable/);
    assert.equal(f.calls, 0);
    const authority = f.domain.acceptNativeCheckChoice(applied.id, review.reviewId, f.decision(review, 'check'))!;
    await assert.rejects(f.domain.runRequiredCheck(applied.id, 'read-grant-1'), /write_authority_required/);
    assert.equal(f.domain.view(applied.id).verification.state, 'approved');
    const result = await f.domain.runRequiredCheck(applied.id, authority.authority);
    assert.equal(result.verification.state, 'passed'); assert.equal(f.calls, 1); assert.equal(f.busy, false);
    await assert.rejects(f.domain.runRequiredCheck(applied.id, authority.authority), /check_unavailable/);
  } finally { await f.close(); }
});

test('denied, unavailable, empty, failed and dispatched-unknown verification never become passed', async () => {
  const f = fixture(); try {
    const applied = f.apply(), denied = f.domain.reviewRequiredCheck(applied.id, f.testPath);
    assert.equal(f.domain.acceptNativeCheckChoice(applied.id, denied.reviewId, f.decision(denied, 'check', 'no')), null);
    assert.equal(f.domain.view(applied.id).verification.state, 'blocked'); assert.equal(f.calls, 0);
    f.runnerReady = false;
    const unavailable = f.check(applied.id); assert.equal((await f.domain.runRequiredCheck(applied.id, unavailable.authority)).verification.state, 'blocked'); assert.equal(f.calls, 0);
    f.runnerReady = true;
    for (const kind of ['empty', 'failed', 'unknown'] as const) {
      f.execute = async () => { if (kind === 'unknown') throw Error('synthetic transport lost after dispatch');
        return { exitCode: kind === 'failed' ? 1 : 0, stdout: '', stderr: '' }; };
      const authority = f.check(applied.id), view = await f.domain.runRequiredCheck(applied.id, authority.authority);
      assert.equal(view.verification.state, kind === 'failed' ? 'failed' : 'unknown'); assert.equal(f.busy, kind === 'unknown');
      assert.equal(f.retained, kind === 'unknown' ? 1 : 0);
    }
  } finally { await f.close(); }
});

test('changed verifier input blocks dispatch; post-dispatch source/grant changes preserve an unknown result', async () => {
  const f = fixture(); try {
    const applied = f.apply(), authority = f.check(applied.id);
    writeFileSync(f.testPath, readFileSync(f.testPath, 'utf8') + '// changed after review\n');
    assert.equal((await f.domain.runRequiredCheck(applied.id, authority.authority)).verification.state, 'blocked'); assert.equal(f.calls, 0);
    const next = f.check(applied.id);
    f.execute = async () => { f.readActive = false; return { exitCode: 0, stdout: tap, stderr: '' }; };
    await assert.rejects(f.domain.runRequiredCheck(applied.id, next.authority), /scope_changed/);
    assert.equal(f.raw(applied.id).check.state, 'unknown'); assert.equal(f.busy, false);
  } finally { await f.close(); }
});

test('inspection integrity and bounded journals fail closed before any write', async () => {
  const f = fixture(); try {
    const inspection = f.inspect(), raw = JSON.parse(String(f.db.prepare('SELECT json FROM mission_file_inspections WHERE id=?').get(inspection.inspectionId)!.json));
    raw.before = after; f.db.prepare('UPDATE mission_file_inspections SET json=? WHERE id=?').run(JSON.stringify(raw), inspection.inspectionId);
    assert.throws(() => f.proposal(inspection), /unavailable/);
    const op = f.proposal().view;
    for (let i = 0; i < 28; i++) f.domain.review(op.id);
    assert.throws(() => f.approve(op.id), /storage_unavailable/);
    assert.equal(readFileSync(f.path, 'utf8'), before); assert.equal(f.raw(op.id).phase, 'awaiting-native-review');
  } finally { await f.close(); }
});

test('close stops waiting promptly, retains the global lease until actual exit and ignores late verification output', async () => {
  const f = fixture(); let releaseRunner = () => {}; try {
    const applied = f.apply(), authority = f.check(applied.id);
    let confirmStarted!: () => void;
    const started = new Promise<void>(resolve => { confirmStarted = resolve; }), finish = new Promise<void>(resolve => { releaseRunner = resolve; });
    f.execute = async () => { confirmStarted(); await finish; return { exitCode: 0, stdout: tap, stderr: '' }; };
    const running = f.domain.runRequiredCheck(applied.id, authority.authority);
    await started; assert.equal(f.calls, 1); assert.equal(f.busy, true);
    await assert.rejects(f.domain.runRequiredCheck(applied.id, authority.authority), /check_unavailable/);
    const rejected = assert.rejects(running, /closed/), began = performance.now(), closing = f.domain.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([closing, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('close waited on held verifier')), 1000); })]); }
    finally { clearTimeout(timer); }
    await rejected; assert.ok(performance.now() - began < 1000);
    assert.equal(f.raw(applied.id).check.state, 'unknown'); assert.equal(f.busy, true); assert.equal(f.retained, 1); assert.equal(f.calls, 1);
    releaseRunner(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(f.raw(applied.id).check.state, 'unknown'); assert.equal(f.busy, false); assert.equal(f.retained, 0);
  } finally { releaseRunner(); await f.close(); }
});

test('mission cancellation settles locally while the real runner lease stays held until exit; late output cannot pass', async () => {
  const f = fixture(); let releaseRunner = () => {}; try {
    const applied = f.apply(), authority = f.check(applied.id), abort = new AbortController();
    let confirmStarted!: () => void;
    const started = new Promise<void>(resolve => { confirmStarted = resolve; }), finish = new Promise<void>(resolve => { releaseRunner = resolve; });
    f.execute = async () => { confirmStarted(); await finish; return { exitCode: 0, stdout: tap, stderr: '' }; };
    const running = f.domain.runRequiredCheck(applied.id, authority.authority, abort.signal); await started; abort.abort();
    const view = await running; assert.equal(view.verification.state, 'unknown'); assert.equal(f.busy, true); assert.equal(f.retained, 1);
    releaseRunner(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(f.domain.view(applied.id).verification.state, 'unknown'); assert.equal(f.busy, false);
  } finally { releaseRunner(); await f.close(); }
});
