import type { Resource } from "../application-contract/contracts.ts";
export type NoteDraft = {
  version: number;
  baseResourceVersion: number;
  content: string;
  updatedAt: string;
};
export type NoteDocument = {
  resource: Pick<
    Resource,
    "id" | "kind" | "title" | "version" | "content" | "project_id"
  >;
  draft: NoteDraft | null;
  draftRevision: number;
  conflict: boolean;
  canRename: boolean;
};
export type SaveNoteDraft = {
  resourceId: string;
  expectedDraftVersion: number;
  baseResourceVersion: number;
  content: string;
};
export type CommitNote = {
  resourceId: string;
  expectedResourceVersion: number;
  expectedDraftVersion: number;
  content: string;
};
export interface NoteExperiencePort {
  readNote(resourceId: string): Promise<NoteDocument>;
  saveNoteDraft(input: SaveNoteDraft): Promise<NoteDraft>;
  commitNote(input: CommitNote): Promise<NoteDocument>;
  discardNoteDraft(input: {
    resourceId: string;
    expectedDraftVersion: number;
  }): Promise<NoteDocument>;
  renameNote?(input: {
    resourceId: string;
    expectedResourceVersion: number;
    title: string;
  }): Promise<NoteDocument>;
}
/** The parent owns effective authorization, canonical mutations and transaction rollback. */
export interface CanonicalNoteHost<Database = unknown> {
  readonly db: Database;
  atomic<T>(work: () => T): T;
  readResource(
    resourceId: string,
  ): { resource: Resource; authorized: boolean } | null;
  updateNote(input: {
    resourceId: string;
    expectedVersion: number;
    content: string;
  }): void;
  renameNote?(input: {
    resourceId: string;
    expectedVersion: number;
    title: string;
  }): void;
}
