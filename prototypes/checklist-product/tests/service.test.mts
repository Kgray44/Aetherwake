import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import { ChecklistService } from '../service.mts';
import type { ChecklistHostPort, ChecklistResource } from '../contracts.ts';
import type { ChecklistOperation, ChecklistReference } from '../../application-contract/checklist.ts';

function fixture(t: any, path = ':memory:') {
  const kernel = WorkspaceKernel.open(path), db = kernel.withTransaction(db => db);
  // Reuse Root's existing logical-kind table, not a parallel resource catalog.
  new DesktopState(kernel, db);
  const revoked = new Set<string>(), readOnly = new Set<string>(), events: Parameters<ChecklistHostPort['recordEvent']>[0][] = [];
  let failEvent = false;
  const read = (resourceId: string): ChecklistResource => {
    const r = kernel.getResource(resourceId).resource, logical = db.prepare('SELECT kind FROM desktop_resources WHERE resource_id=?').get(resourceId);
    return { id: r.id, kind: String(logical?.kind ?? r.kind), title: r.title, version: r.version, projectId: r.project_id, state: r.state };
  };
  const host: ChecklistHostPort = {
    db,
    atomic(work) { const count = events.length; try { return kernel.withTransaction(work); } catch (error) { events.length = count; throw error; } },
    createResource(input) { const r = kernel.createGenericResource(input.title, input.projectId); db.prepare('INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)').run(r.id, 'checklist'); return read(r.id); },
    readResource(resourceId) { try { const resource = read(resourceId); return { resource, authorized: !revoked.has(resourceId) && (!resource.projectId || kernel.subjectState({ kind: 'project', projectId: resource.projectId }) === 'active'), writable: !readOnly.has(resourceId) }; } catch { return null; } },
    touchResource(input) { kernel.touchGenericResource(input.resourceId, input.expectedVersion); return read(input.resourceId); },
    resolveReference(ref) {
      if (ref.kind === 'resource' || ref.kind === 'conversation') {
        const value = host.readResource(ref.resourceId);
        return value?.authorized && value.resource.state === 'active' && (ref.kind !== 'conversation' || value.resource.kind === 'conversation')
          ? { available: true, title: value.resource.title } : { available: false };
      }
      if (ref.kind === 'project') { const p = db.prepare('SELECT id,title,state FROM projects WHERE id=?').get(ref.projectId); return p && p.state === 'active' && !revoked.has(String(p.id)) ? { available: true, title: String(p.title) } : { available: false }; }
      return { available: false };
    },
    mutationContext: () => ({ actor: { kind: 'user', id: 'user:synthetic' }, authority: 'manual', at: new Date().toISOString() }),
    recordEvent(event) { events.push(structuredClone(event)); if (failEvent) throw new Error('synthetic_canonical_event_failure'); },
  };
  const service = new ChecklistService(kernel, host);
  let closed = false; const close = () => { if (!closed) { closed = true; kernel.close(); } }; t.after(close);
  const count = (table: 'resources' | 'notes' | 'conversation_refs' | 'blocks' | 'workspaces' | 'checklist_documents' | 'checklist_receipts') => Number(db.prepare('SELECT count(*) AS n FROM ' + table).get()!.n);
  const mutate = (resourceId: string, operations: ChecklistOperation[], expectedVersion = service.read(resourceId).resource.version) => service.mutate({ commandId: randomUUID(), resourceId, expectedVersion, operations });
  return { kernel, db, host, service, events, revoked, readOnly, count, mutate, close, failEvent: () => { failEvent = true; } };
}

test('standalone checklist uses a real canonical generic ID with no Note, conversation, workspace or placement, and survives actual SQLite reopen', t => {
  const profile = mkdtempSync(join(tmpdir(), 'aerynth-checklist-source-')); t.diagnostic('Retained synthetic Checklist source receipt: ' + profile);
  const path = join(profile, 'canonical.sqlite'), f = fixture(t, path), created = f.service.create({ commandId: 'checklist:standalone', title: 'Synthetic independent checklist' });
  assert.equal(f.kernel.getResource(created.resourceId).resource.kind, 'generic'); assert.equal(f.count('resources'), 1); assert.equal(f.count('notes'), 0);
  assert.equal(f.count('conversation_refs'), 0); assert.equal(f.count('workspaces'), 0); assert.equal(f.count('blocks'), 0);
  const added = f.mutate(created.resourceId, [{ type: 'addEntry', key: 'first', entry: { text: 'Manual first item', priority: 'high', dueDate: '2028-02-29' } }]);
  f.mutate(created.resourceId, [{ type: 'setChecked', entryId: added.createdIds.first, checked: true }]);
  const before = f.service.read(created.resourceId); f.close(); const reopened = fixture(t, path);
  assert.deepEqual(reopened.service.read(created.resourceId), before); assert.equal(before.entries[0].completion!.basis, 'manual'); assert.equal(before.entries[0].checked, true);
  assert.equal(before.syncPolicy, 'manual'); assert.equal(reopened.count('blocks'), 0); assert.equal(reopened.count('notes'), 0);
});
test('conversation-linked creation, entry editing/order/groups/priority/due dates and source references preserve canonical identity and explicit provenance', t => {
  const f = fixture(t), conversation = f.kernel.createConversationRef('Synthetic linked conversation'), note = f.kernel.createNote('Synthetic referenced note', 'Original source remains intact');
  const created = f.service.create({ commandId: randomUUID(), title: 'Conversation checklist', conversationId: conversation.id });
  assert.deepEqual(f.service.read(created.resourceId).references[0].target, { kind: 'conversation', resourceId: conversation.id });
  const group = f.mutate(created.resourceId, [{ type: 'addGroup', key: 'group', title: 'Today' }]).createdIds.group;
  const entries = f.mutate(created.resourceId, [
    { type: 'addEntry', key: 'one', entry: { text: 'First', description: 'Actual manual description', groupId: group, references: [{ kind: 'resource', resourceId: note.id }] } },
    { type: 'addEntry', key: 'two', entry: { text: 'Second' } },
  ]).createdIds;
  f.mutate(created.resourceId, [{ type: 'editEntry', entryId: entries.one, patch: { text: 'Edited first', priority: 'urgent', dueDate: '2026-12-01' } },
    { type: 'reorderEntries', entryIds: [entries.two, entries.one] }, { type: 'setChecked', entryId: entries.one, checked: true }]);
  const doc = f.service.read(created.resourceId); assert.equal(doc.resource.id, created.resourceId); assert.deepEqual(doc.entries.map(e => e.id), [entries.two, entries.one]);
  assert.equal(doc.entries[1].groupId, group); assert.equal(doc.entries[1].priority, 'urgent'); assert.equal(doc.entries[1].dueDate, '2026-12-01');
  assert.equal(doc.entries[1].created.actor.kind, 'user'); assert.equal(doc.entries[1].completion!.basis, 'manual'); assert.equal(f.kernel.getResource(note.id).note.content, 'Original source remains intact');
  assert.equal(f.count('resources'), 3); assert.equal(f.count('notes'), 1); assert.equal(f.count('workspaces'), 0); assert.equal(f.count('blocks'), 0);
  f.mutate(created.resourceId, [{ type: 'removeGroup', groupId: group }]); assert.equal(f.service.read(created.resourceId).entries[1].groupId, null);
});
test('canonical version fences/idempotent receipts reject stale or reused commands, and an event failure rolls back domain, canonical version, events and retry receipt together', t => {
  const f = fixture(t), input = { commandId: 'create:retry', title: 'Synthetic atomic checklist' }, created = f.service.create(input);
  assert.deepEqual(f.service.create(input), created); assert.equal(f.count('resources'), 1);
  assert.throws(() => f.service.create({ ...input, title: 'Different command' }), /checklist_command_conflict/);
  const command = { commandId: 'entry:retry', resourceId: created.resourceId, expectedVersion: 1, operations: [{ type: 'addEntry' as const, key: 'one', entry: { text: 'One' } }] };
  const changed = f.service.mutate(command); assert.deepEqual(f.service.mutate(command), changed); assert.equal(f.service.read(created.resourceId).entries.length, 1);
  assert.throws(() => f.mutate(created.resourceId, [{ type: 'setChecked', entryId: changed.createdIds.one, checked: true }], 1), /checklist_version_conflict/);
  const before = f.service.read(created.resourceId), count = f.count('checklist_receipts'), eventCount = f.events.length;
  f.failEvent(); assert.throws(() => f.mutate(created.resourceId, [{ type: 'setChecked', entryId: changed.createdIds.one, checked: true }]), /synthetic_canonical_event_failure/);
  assert.deepEqual(f.service.read(created.resourceId), before); assert.equal(f.count('checklist_receipts'), count); assert.equal(f.events.length, eventCount);
});
test('revocation/read-only gates, unsupported future sources, invalid dates/order/provenance and denied references never mutate or fake task completion', t => {
  const f = fixture(t), created = f.service.create({ commandId: randomUUID(), title: 'Synthetic access checklist' });
  const entry = f.mutate(created.resourceId, [{ type: 'addEntry', key: 'one', entry: { text: 'Manual remains independent' } }]).createdIds.one;
  const before = f.service.read(created.resourceId);
  for (const reference of [{ kind: 'agent', agentId: 'not:released' }, { kind: 'task', taskId: 'not:verified' }, { kind: 'workflow', workflowId: 'not:released' }] as ChecklistReference[])
    assert.throws(() => f.mutate(created.resourceId, [{ type: 'addReference', entryId: entry, reference }]), /checklist_reference_unavailable/);
  assert.throws(() => f.mutate(created.resourceId, [{ type: 'editEntry', entryId: entry, patch: { dueDate: '2027-02-29' } }]), /invalid_checklist_input/);
  assert.throws(() => f.mutate(created.resourceId, [{ type: 'reorderEntries', entryIds: [] }]), /invalid_checklist_order/);
  assert.throws(() => f.mutate(created.resourceId, [{ type: 'setChecked', entryId: entry, checked: true, basis: 'verified' } as any]), /invalid_checklist_input/);
  assert.deepEqual(f.service.read(created.resourceId), before);
  f.readOnly.add(created.resourceId); assert.equal(f.service.read(created.resourceId).canEdit, false); assert.throws(() => f.mutate(created.resourceId, [{ type: 'setChecked', entryId: entry, checked: true }]), /checklist_read_only/);
  f.revoked.add(created.resourceId); assert.throws(() => f.service.read(created.resourceId), /checklist_unavailable/);
});
test('revoked linked-source metadata is redacted while retained references and independent manual editing survive', t => {
  const f = fixture(t), note = f.kernel.createNote('Synthetic private reference', 'Private original text'), created = f.service.create({ commandId: randomUUID(), title: 'Synthetic redaction checklist' });
  const entry = f.mutate(created.resourceId, [{ type: 'addEntry', key: 'one', entry: { text: 'Manual item', references: [{ kind: 'resource', resourceId: note.id }] } }]).createdIds.one;
  const stored = String(f.db.prepare('SELECT json FROM checklist_documents WHERE resource_id=?').get(created.resourceId)!.json);
  f.revoked.add(note.id); const redacted = f.service.read(created.resourceId).entries[0].references[0]; assert.equal(redacted.available, false); assert.equal(redacted.target, undefined); assert.doesNotMatch(JSON.stringify(redacted), new RegExp(note.id));
  f.mutate(created.resourceId, [{ type: 'setChecked', entryId: entry, checked: true }]);
  assert.equal(f.service.read(created.resourceId).entries[0].checked, true); assert.match(stored, new RegExp(note.id)); assert.match(String(f.db.prepare('SELECT json FROM checklist_documents WHERE resource_id=?').get(created.resourceId)!.json), new RegExp(note.id));
});
