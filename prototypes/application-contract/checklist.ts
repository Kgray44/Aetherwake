/** Canonical checklists are independent of chats, manual Task records, agents
 * and workspace placements. Entry/group/reference IDs are subordinate IDs. */
export type ChecklistReference =
  | { kind: 'resource'; resourceId: string }
  | { kind: 'conversation'; resourceId: string; messageId?: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'timeline-item'; timelineId: string; itemId: string };
export type ChecklistPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ChecklistActor = { kind: 'user' | 'assistant' | 'agent' | 'workflow' | 'import'; id?: string };
export type ChecklistAttribution = { actor: ChecklistActor; authority: 'manual' | 'user-approved'; at: string };
export type ChecklistReferenceView = { id: string; kind: ChecklistReference['kind']; available: boolean; title: string; target?: ChecklistReference };
export type ChecklistEntry = {
  id: string; text: string; description: string; checked: boolean; priority: ChecklistPriority;
  dueDate: string | null; groupId: string | null; references: ChecklistReferenceView[];
  created: ChecklistAttribution; updated: ChecklistAttribution;
  completion: (ChecklistAttribution & { basis: 'manual' | 'user-approved' }) | null;
};
export type ChecklistGroup = { id: string; title: string };
export type ChecklistDocument = {
  schemaVersion: 1;
  resource: { id: string; kind: 'checklist'; title: string; projectId: string | null; version: number };
  canEdit: boolean; syncPolicy: 'manual'; references: ChecklistReferenceView[];
  groups: ChecklistGroup[]; entries: ChecklistEntry[];
  created: ChecklistAttribution; updated: ChecklistAttribution;
};
export type ChecklistEntryInput = { text: string; description?: string; priority?: ChecklistPriority; dueDate?: string | null; groupId?: string | null; references?: ChecklistReference[] };
export type ChecklistOperation =
  | { type: 'addEntry'; key: string; entry: ChecklistEntryInput }
  | { type: 'editEntry'; entryId: string; patch: Partial<Omit<ChecklistEntryInput, 'references'>> }
  | { type: 'setChecked'; entryId: string; checked: boolean }
  | { type: 'removeEntry'; entryId: string }
  | { type: 'reorderEntries'; entryIds: string[] }
  | { type: 'addGroup'; key: string; title: string }
  | { type: 'renameGroup'; groupId: string; title: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'reorderGroups'; groupIds: string[] }
  | { type: 'addReference'; entryId?: string; reference: ChecklistReference }
  | { type: 'removeReference'; entryId?: string; referenceId: string };
export type CreateChecklist = { commandId: string; title: string; projectId?: string | null; conversationId?: string };
export type MutateChecklist = { commandId: string; resourceId: string; expectedVersion: number; operations: ChecklistOperation[] };
/** IDs/version only; idempotency receipts never duplicate checklist plaintext. */
export type ChecklistMutationResult = { resourceId: string; version: number; createdIds: Record<string, string> };
export interface ChecklistPort {
  create(input: CreateChecklist): Promise<ChecklistMutationResult>;
  read(resourceId: string): Promise<ChecklistDocument>;
  mutate(input: MutateChecklist): Promise<ChecklistMutationResult>;
}
export const CHECKLIST_LIMITS = Object.freeze({ documents: 256, entries: 256, groups: 32, references: 16, entryReferences: 8, operations: 256, receipts: 1024, bodyBytes: 512 * 1024 });
