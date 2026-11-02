import { randomUUID } from 'node:crypto';
import { CHECKLIST_LIMITS, type ChecklistAttribution, type ChecklistEntryInput, type ChecklistGroup, type ChecklistReference, type ChecklistEntry } from '../application-contract/checklist.ts';
export class ChecklistError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; this.name = 'ChecklistError'; } }
export function check(value: unknown, code = 'invalid_checklist_input'): asserts value { if (!value) throw new ChecklistError(code); }
export function object(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)));
}
export function id(value: unknown): string { check(typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\0-\x1f]/.test(value)); return value; }
export function text(value: unknown, maximum: number, empty = false): string {
  check(typeof value === 'string' && value.length <= maximum && !value.includes('\0') && (empty || value.trim().length > 0)); return value;
}
export function version(value: unknown): number { check(Number.isSafeInteger(value) && Number(value) > 0); return Number(value); }
export function dueDate(value: unknown): string | null {
  if (value === null) return null;
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const date = new Date(value + 'T00:00:00.000Z'); check(!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value); return value;
}
export function reference(value: ChecklistReference): ChecklistReference {
  const keys = { resource: ['resourceId'], conversation: ['resourceId', 'messageId'], project: ['projectId'], agent: ['agentId'], task: ['taskId'], workflow: ['workflowId'], 'timeline-item': ['timelineId', 'itemId'] } as const;
  check(value && Object.hasOwn(keys, value.kind)); object(value, ['kind', ...keys[value.kind]]);
  const fields = value as unknown as Record<string, unknown>;
  for (const key of keys[value.kind]) if (key !== 'messageId' || fields[key] !== undefined) id(fields[key]);
  return structuredClone(value);
}
export type StoredReference = { id: string; target: ChecklistReference };
export type StoredEntry = Omit<ChecklistEntry, 'references'> & { references: StoredReference[] };
export type StoredChecklist = { schemaVersion: 1; syncPolicy: 'manual'; references: StoredReference[]; groups: ChecklistGroup[]; entries: StoredEntry[]; created: ChecklistAttribution; updated: ChecklistAttribution };
export const makeReference = (value: ChecklistReference): StoredReference => ({ id: 'checklist-reference:' + randomUUID(), target: reference(value) });
export function attribution(value: ChecklistAttribution): ChecklistAttribution {
  object(value, ['actor', 'authority', 'at']); object(value.actor, ['kind', 'id']);
  check(['user', 'assistant', 'agent', 'workflow', 'import'].includes(value.actor.kind) && ['manual', 'user-approved'].includes(value.authority));
  if (value.actor.id !== undefined) id(value.actor.id);
  check(typeof value.at === 'string' && new Date(value.at).toISOString() === value.at); return structuredClone(value);
}
export function entryInput(value: Partial<ChecklistEntryInput>, groups: readonly ChecklistGroup[], partial = false) {
  object(value, ['text', 'description', 'priority', 'dueDate', 'groupId', ...(partial ? [] : ['references'])]);
  const result: Partial<Omit<ChecklistEntryInput, 'references'>> = {};
  if (!partial || value.text !== undefined) result.text = text(value.text, 240);
  if (value.description !== undefined) result.description = text(value.description, 4000, true);
  if (value.priority !== undefined) { check(['low', 'normal', 'high', 'urgent'].includes(value.priority)); result.priority = value.priority; }
  if (value.dueDate !== undefined) result.dueDate = dueDate(value.dueDate);
  if (value.groupId !== undefined) { check(value.groupId === null || groups.some(group => group.id === id(value.groupId)), 'checklist_group_missing'); result.groupId = value.groupId; }
  if (!partial && value.references !== undefined) { check(Array.isArray(value.references) && value.references.length <= CHECKLIST_LIMITS.entryReferences); value.references.forEach(reference); }
  return result;
}
export function validateBody(body: StoredChecklist) {
  object(body, ['schemaVersion', 'syncPolicy', 'references', 'groups', 'entries', 'created', 'updated']);
  check(body.schemaVersion === 1 && body.syncPolicy === 'manual' && Array.isArray(body.entries) && Array.isArray(body.groups) && Array.isArray(body.references), 'checklist_integrity');
  check(body.entries.length <= CHECKLIST_LIMITS.entries && body.groups.length <= CHECKLIST_LIMITS.groups && body.references.length <= CHECKLIST_LIMITS.references, 'checklist_capacity');
  const ids = new Set<string>();
  const unique = (value: string) => { id(value); check(!ids.has(value), 'checklist_duplicate_id'); ids.add(value); };
  for (const group of body.groups) { unique(group.id); text(group.title, 120); }
  const validateReferences = (refs: StoredReference[], maximum: number) => { check(Array.isArray(refs) && refs.length <= maximum, 'checklist_capacity'); for (const value of refs) { unique(value.id); reference(value.target); } };
  validateReferences(body.references, CHECKLIST_LIMITS.references);
  for (const entry of body.entries) {
    object(entry, ['id', 'text', 'description', 'checked', 'priority', 'dueDate', 'groupId', 'references', 'created', 'updated', 'completion']);
    unique(entry.id); entryInput({ text: entry.text, description: entry.description, priority: entry.priority, dueDate: entry.dueDate, groupId: entry.groupId }, body.groups);
    check(typeof entry.checked === 'boolean', 'checklist_integrity'); validateReferences(entry.references, CHECKLIST_LIMITS.entryReferences);
    attribution(entry.created); attribution(entry.updated);
    if (entry.completion) {
      object(entry.completion, ['actor', 'authority', 'at', 'basis']); check(['manual', 'user-approved'].includes(entry.completion.basis), 'checklist_integrity');
      attribution({ actor: entry.completion.actor, authority: entry.completion.authority, at: entry.completion.at });
    }
  }
  attribution(body.created); attribution(body.updated);
  check(Buffer.byteLength(JSON.stringify(body), 'utf8') <= CHECKLIST_LIMITS.bodyBytes, 'checklist_capacity');
  return body;
}
