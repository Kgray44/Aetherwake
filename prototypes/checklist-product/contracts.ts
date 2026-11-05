import type { DatabaseSync } from 'node:sqlite';
import type { ChecklistAttribution, ChecklistReference } from '../application-contract/checklist.ts';
export type * from '../application-contract/checklist.ts';
export type ChecklistResource = { id: string; kind: string; title: string; projectId: string | null; version: number; state: 'active' | 'archived' };
/** Main-process host, all callbacks synchronous and composed in the SAME
 * kernel transaction. Root owns grants, canonical identities and event stream. */
export interface ChecklistHostPort {
  readonly db: DatabaseSync;
  atomic<T>(work: () => T): T;
  createResource(input: { kind: 'checklist'; title: string; projectId: string | null }): ChecklistResource;
  readResource(resourceId: string): { resource: ChecklistResource; authorized: boolean; writable: boolean } | null;
  touchResource(input: { resourceId: string; expectedVersion: number }): ChecklistResource;
  resolveReference(reference: ChecklistReference, scope: { resourceId: string; projectId: string | null }): { available: boolean; title?: string };
  /** Root derives actor/review authority; these are never renderer fields. */
  mutationContext(): ChecklistAttribution;
  recordEvent(input: { resourceId: string; resourceVersion: number; type: 'checklist.created' | 'checklist.changed'; detail: {
    commandId: string; operationTypes: string[]; entryCount: number; groupCount: number;
    authority: 'manual' | 'user-approved'; actorKind: ChecklistAttribution['actor']['kind'];
    affectedIds: string[]; affectedIdsTruncated: boolean;
  } }): void;
}
