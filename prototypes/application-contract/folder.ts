/** A canonical local folder source. This is distinct from a file or a visual placement. */
export interface FolderMetadata {
  source: 'folder';
  name: string;
  /** Metadata revision only; this is not a recursive content digest. */
  sourceRevision: string;
}

export type FolderAccessState = 'available' | 'revoked' | 'unavailable' | 'changed';
export interface FolderDescription {
  resourceId: string;
  metadata: FolderMetadata;
  accessState: FolderAccessState;
  capabilities: { list: boolean; openExternal: boolean };
}

/** IDs are short-lived, resource-scoped listing handles, not canonical child resources. */
export interface FolderEntry {
  id: string;
  name: string;
  kind: 'folder' | 'file' | 'unsupported';
  sourceRevision: string;
  byteLength?: number;
}

export interface FolderBrowseRequest {
  resourceId: string;
  entryId?: string;
  cursor?: string;
}

export interface FolderBrowseResponse {
  resourceId: string;
  /** Null denotes the selected canonical folder itself. */
  entryId: string | null;
  name: string;
  entries: FolderEntry[];
  /** Opaque continuation for this exact observed listing, or null. */
  cursor: string | null;
  truncated: boolean;
  observedRevision: string;
  scope: 'metadata-only';
}

export type FolderRequest =
  | { type: 'describe'; resourceId: string }
  | ({ type: 'list' } & FolderBrowseRequest);

/** Native gesture handlers resolve directory targets privately; public requests never return paths. */
export type FolderResponse = FolderDescription | FolderBrowseResponse;
