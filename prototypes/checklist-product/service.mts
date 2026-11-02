import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceKernel } from '../workspace-kernel/kernel.mts';
import { CHECKLIST_LIMITS, type ChecklistDocument, type ChecklistMutationResult, type ChecklistOperation, type ChecklistReference, type ChecklistReferenceView, type CreateChecklist, type MutateChecklist } from '../application-contract/checklist.ts';
import type { ChecklistHostPort, ChecklistResource } from './contracts.ts';
import { attribution, check, entryInput, id, makeReference, object, reference, text, validateBody, version, type StoredChecklist, type StoredEntry, type StoredReference } from './model.ts';

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');

/** Specialized domain extension of Root's actual canonical generic resources.
 * Owns no connection, Notes, workspace placements, provider or event database. */
export class ChecklistService {
  private readonly host: ChecklistHostPort;
  constructor(kernel: WorkspaceKernel, host: ChecklistHostPort) {
    kernel.withTransaction(db => check(db === host.db, 'canonical_connection_required'));
    this.host = host;
    host.atomic(() => {
      host.db.exec(`CREATE TABLE IF NOT EXISTS checklist_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS checklist_documents(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS checklist_receipts(command_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,result_json TEXT NOT NULL);`);
      const rows = host.db.prepare('SELECT version FROM checklist_schema').all();
      if (!rows.length) host.db.prepare('INSERT INTO checklist_schema VALUES(1)').run();
      else check(rows.length === 1 && rows[0].version === 1, 'unsupported_checklist_schema');
    });
  }
  private resource(resourceId: string, write = false): ChecklistResource {
    const entry = this.host.readResource(id(resourceId));
    check(entry?.authorized && entry.resource.kind === 'checklist' && entry.resource.state === 'active', 'checklist_unavailable');
    check(!write || entry.writable === true, 'checklist_read_only');
    return entry.resource;
  }
  private body(resourceId: string): StoredChecklist {
    const row = this.host.db.prepare('SELECT json FROM checklist_documents WHERE resource_id=?').get(resourceId);
    check(row && typeof row.json === 'string', 'checklist_unavailable');
    return validateBody(JSON.parse(row.json));
  }
  private resolve(ref: ChecklistReference, resource: ChecklistResource) {
    return this.host.resolveReference(reference(ref), { resourceId: resource.id, projectId: resource.projectId });
  }
  private requireReference(ref: ChecklistReference, resource: ChecklistResource): StoredReference {
    check(this.resolve(ref, resource).available === true, 'checklist_reference_unavailable'); return makeReference(ref);
  }
  private projectedReferences(refs: StoredReference[], resource: ChecklistResource): ChecklistReferenceView[] {
    return refs.map(ref => {
      const resolved = this.resolve(ref.target, resource);
      return resolved.available === true
        ? { id: ref.id, kind: ref.target.kind, available: true, title: text(resolved.title ?? 'Linked source', 512), target: structuredClone(ref.target) }
        : { id: ref.id, kind: ref.target.kind, available: false, title: 'Source unavailable' };
    });
  }
  read(resourceId: string): ChecklistDocument {
    return this.host.atomic(() => {
      const resource = this.resource(resourceId), body = this.body(resource.id);
      return { ...body, resource: { id: resource.id, kind: 'checklist', title: resource.title, version: resource.version, projectId: resource.projectId },
        canEdit: this.host.readResource(resource.id)!.writable === true,
        references: this.projectedReferences(body.references, resource),
        entries: body.entries.map(entry => ({ ...entry, references: this.projectedReferences(entry.references, resource) })) };
    });
  }
  private once(commandId: string, input: unknown, work: () => ChecklistMutationResult): ChecklistMutationResult {
    id(commandId); check(commandId.length <= 200); const fingerprint = digest(input), old = this.host.db.prepare('SELECT * FROM checklist_receipts WHERE command_id=?').get(commandId);
    if (old) {
      check(old.fingerprint === fingerprint, 'checklist_command_conflict'); this.resource(String(old.resource_id), true);
      return JSON.parse(String(old.result_json));
    }
    check(Number(this.host.db.prepare('SELECT count(*) AS n FROM checklist_receipts').get()!.n) < CHECKLIST_LIMITS.receipts, 'checklist_receipt_capacity');
    const result = work();
    this.host.db.prepare('INSERT INTO checklist_receipts VALUES(?,?,?,?)').run(commandId, fingerprint, result.resourceId, JSON.stringify(result)); return result;
  }
  create(input: CreateChecklist): ChecklistMutationResult {
    object(input, ['commandId', 'title', 'projectId', 'conversationId']);
    const title = text(input.title, 200), projectId = input.projectId === undefined || input.projectId === null ? null : id(input.projectId);
    if (input.conversationId !== undefined) id(input.conversationId);
    return this.host.atomic(() => this.once(input.commandId, { operation: 'create', input }, () => {
      check(Number(this.host.db.prepare('SELECT count(*) AS n FROM checklist_documents').get()!.n) < CHECKLIST_LIMITS.documents, 'checklist_capacity');
      const previous = Number(this.host.db.prepare('SELECT coalesce(max(rowid),0) AS n FROM resources').get()!.n);
      const created = this.host.createResource({ kind: 'checklist', title, projectId }), resource = this.resource(created.id, true);
      const canonical = this.host.db.prepare('SELECT rowid,kind FROM resources WHERE id=?').get(resource.id);
      check(canonical?.kind === 'generic' && Number(canonical.rowid) > previous && resource.version === 1 && resource.projectId === projectId, 'canonical_checklist_factory_required');
      check(!this.host.db.prepare('SELECT 1 FROM notes WHERE resource_id=?').get(resource.id), 'canonical_checklist_factory_required');
      const context = attribution(this.host.mutationContext());
      const body: StoredChecklist = { schemaVersion: 1, syncPolicy: 'manual', groups: [], entries: [], references: [], created: context, updated: context };
      if (input.conversationId) body.references.push(this.requireReference({ kind: 'conversation', resourceId: input.conversationId }, resource));
      this.host.db.prepare('INSERT INTO checklist_documents VALUES(?,?)').run(resource.id, JSON.stringify(validateBody(body)));
      this.host.recordEvent({ resourceId: resource.id, resourceVersion: resource.version, type: 'checklist.created', detail: { commandId: input.commandId,
        operationTypes: ['create'], entryCount: 0, groupCount: 0, authority: context.authority, actorKind: context.actor.kind, affectedIds: [], affectedIdsTruncated: false } });
      return { resourceId: resource.id, version: resource.version, createdIds: {} };
    }));
  }
  mutate(input: MutateChecklist): ChecklistMutationResult {
    object(input, ['commandId', 'resourceId', 'expectedVersion', 'operations']); id(input.resourceId); version(input.expectedVersion);
    check(Array.isArray(input.operations) && input.operations.length > 0 && input.operations.length <= CHECKLIST_LIMITS.operations);
    return this.host.atomic(() => this.once(input.commandId, { operation: 'mutate', input }, () => {
      const resource = this.resource(input.resourceId, true); check(resource.version === input.expectedVersion, 'checklist_version_conflict');
      const body = this.body(resource.id), before = digest(body), context = attribution(this.host.mutationContext()), createdIds: Record<string, string> = {};
      const entry = (entryId: string): StoredEntry => { const found = body.entries.find(entry => entry.id === id(entryId)); check(found, 'checklist_entry_missing'); return found; };
      const refs = (entryId?: string) => entryId === undefined ? body.references : entry(entryId).references;
      const key = (value: string, created: string) => { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)); check(!Object.hasOwn(createdIds, value), 'checklist_duplicate_operation_key'); createdIds[value] = created; };
      const reorder = <T extends { id: string }>(items: T[], ordered: string[]) => {
        check(Array.isArray(ordered) && ordered.length === items.length && new Set(ordered).size === ordered.length && ordered.every(value => items.some(item => item.id === value)), 'invalid_checklist_order');
        return ordered.map(value => items.find(item => item.id === value)!);
      };
      for (const operation of input.operations) {
        check(operation && typeof operation === 'object');
        switch (operation.type) {
          case 'addEntry': {
            object(operation, ['type', 'key', 'entry']); const input = entryInput(operation.entry, body.groups), entryId = 'checklist-entry:' + randomUUID(); key(operation.key, entryId);
            body.entries.push({ id: entryId, text: input.text!, description: input.description ?? '', checked: false, priority: input.priority ?? 'normal',
              dueDate: input.dueDate ?? null, groupId: input.groupId ?? null, references: (operation.entry.references ?? []).map(ref => this.requireReference(ref, resource)),
              created: context, updated: context, completion: null }); break;
          }
          case 'editEntry': { object(operation, ['type', 'entryId', 'patch']); const current = entry(operation.entryId); Object.assign(current, entryInput(operation.patch, body.groups, true)); current.updated = context; break; }
          case 'setChecked': {
            object(operation, ['type', 'entryId', 'checked']); check(typeof operation.checked === 'boolean'); const current = entry(operation.entryId);
            if (current.checked !== operation.checked) { current.checked = operation.checked; current.updated = context; current.completion = { ...context, basis: context.authority }; } break;
          }
          case 'removeEntry': object(operation, ['type', 'entryId']); entry(operation.entryId); body.entries = body.entries.filter(item => item.id !== operation.entryId); break;
          case 'reorderEntries': object(operation, ['type', 'entryIds']); body.entries = reorder(body.entries, operation.entryIds); break;
          case 'addGroup': { object(operation, ['type', 'key', 'title']); const groupId = 'checklist-group:' + randomUUID(); key(operation.key, groupId); body.groups.push({ id: groupId, title: text(operation.title, 120) }); break; }
          case 'renameGroup': { object(operation, ['type', 'groupId', 'title']); const group = body.groups.find(group => group.id === id(operation.groupId)); check(group, 'checklist_group_missing'); group.title = text(operation.title, 120); break; }
          case 'removeGroup': {
            object(operation, ['type', 'groupId']); check(body.groups.some(group => group.id === id(operation.groupId)), 'checklist_group_missing');
            body.groups = body.groups.filter(group => group.id !== operation.groupId); for (const current of body.entries) if (current.groupId === operation.groupId) { current.groupId = null; current.updated = context; } break;
          }
          case 'reorderGroups': object(operation, ['type', 'groupIds']); body.groups = reorder(body.groups, operation.groupIds); break;
          case 'addReference': object(operation, ['type', 'entryId', 'reference']); refs(operation.entryId).push(this.requireReference(operation.reference, resource)); break;
          case 'removeReference': {
            object(operation, ['type', 'entryId', 'referenceId']); const references = refs(operation.entryId), index = references.findIndex(ref => ref.id === id(operation.referenceId)); check(index >= 0, 'checklist_reference_missing'); references.splice(index, 1); break;
          }
          default: check(false, 'unsupported_checklist_operation');
        }
      }
      validateBody(body);
      if (digest(body) === before) return { resourceId: resource.id, version: resource.version, createdIds };
      body.updated = context; validateBody(body);
      const touched = this.host.touchResource({ resourceId: resource.id, expectedVersion: resource.version });
      check(touched.id === resource.id && touched.kind === 'checklist' && touched.version === resource.version + 1 && touched.projectId === resource.projectId && touched.title === resource.title, 'canonical_checklist_version_required');
      this.host.db.prepare('UPDATE checklist_documents SET json=? WHERE resource_id=?').run(JSON.stringify(body), resource.id);
      const affectedIds = [...new Set([...Object.values(createdIds), ...input.operations.flatMap(operation => 'entryId' in operation && operation.entryId ? [operation.entryId]
        : 'groupId' in operation ? [operation.groupId] : 'entryIds' in operation ? operation.entryIds : 'groupIds' in operation ? operation.groupIds : [])])];
      this.host.recordEvent({ resourceId: resource.id, resourceVersion: touched.version, type: 'checklist.changed', detail: { commandId: input.commandId,
        operationTypes: [...new Set(input.operations.map(operation => operation.type))], entryCount: body.entries.length, groupCount: body.groups.length,
        authority: context.authority, actorKind: context.actor.kind, affectedIds: affectedIds.slice(0, 32), affectedIdsTruncated: affectedIds.length > 32 } });
      return { resourceId: resource.id, version: touched.version, createdIds };
    }));
  }
}
