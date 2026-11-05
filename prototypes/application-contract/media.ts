import type { Resource } from './contracts.ts';

/** Renderer-safe canonical metadata. Native locators/bookmarks/paths stay in
 * the existing private canonical store and never cross this contract. */
export type MediaFileFormat = 'pdf' | 'docx' | 'video' | 'image' | 'text' | 'binary';
type MediaIdentity = { name: string; mime: string; sourceRevision: string };
export type MediaMetadata = MediaIdentity & (
  | { source: 'file'; format: MediaFileFormat; byteLength: number; url?: never; youtubeId?: never }
  | { source: 'link'; format: 'web'; url: string; byteLength?: never; youtubeId?: never }
  | { source: 'link'; format: 'youtube'; url: string; youtubeId: string; byteLength?: never }
);
export type MediaCapabilities = { read: boolean; play: boolean; embed: boolean; openExternal: boolean };
export type MediaReadRequest = { resourceId: string; expectedVersion: number; sourceRevision: string };
export type MediaAccessErrorCode = 'unavailable' | 'revoked' | 'permission_required' | 'source_changed' | 'too_large' | 'unsupported' | 'invalid_data' | 'timeout';
export type MediaAccessFailure = { code: MediaAccessErrorCode; message?: string };
export type MediaPlaybackLease = { leaseId: string; src: string; kind: 'local-video' | 'youtube'; mime: string };

/** Every native call revalidates current canonical authorization, version and
 * the actual selected source revision. readBytes is capped at1MiB per chunk.
 * No method accepts a renderer-supplied filesystem path or arbitrary URL. */
export interface MediaReadPort {
  describe(input: { resourceId: string }): Promise<{ metadata: MediaMetadata; capabilities: MediaCapabilities }>;
  readBytes(input: MediaReadRequest & { offset: number; length: number }): Promise<Uint8Array>;
  acquirePlayback(input: MediaReadRequest & { intent: 'local-video' | 'youtube' }): Promise<MediaPlaybackLease>;
  releasePlayback(input: { leaseId: string }): Promise<void>;
  openExternal(input: { resourceId: string; expectedVersion: number }): Promise<void>;
}

export type MediaImportRequest = {
  kind: 'file' | 'link';
  variant?: 'pdf' | 'document' | 'video' | 'any';
  workspaceId?: string;
  expectedLayoutVersion?: number;
  projectId?: string | null;
  /** User-entered HTTP(S) link. Local files always come from the native picker. */
  url?: string;
  bounds?: { x: number; y: number; width: number; height: number };
};
/** Explicit user creation, separate from read-only opening. Cancellation has
 * no effects. An optional explicit placement is committed atomically with its
 * canonical import and expected-layout fence by the host. */
export interface MediaImportPort {
  chooseMediaForAdd(input: MediaImportRequest): Promise<{ resource: Resource; placementId?: string } | null>;
}

export const MEDIA_LIMITS = Object.freeze({
  chunkBytes: 1024 * 1024,
  pdfBytes: 32 * 1024 * 1024,
  docxBytes: 16 * 1024 * 1024,
  expandedDocxBytes: 32 * 1024 * 1024,
  zipEntries: 256,
  textBytes: 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  imagePixels: 16 * 1024 * 1024,
  pdfPages: 1000,
  canvasPixels: 2 * 1024 * 1024,
  parserTimeoutMs: 10000,
});
