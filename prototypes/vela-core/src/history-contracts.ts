import type { ResourceRef } from './contracts.ts';

/** Browser-safe data only. Known null navigation is deliberately distinct from unavailable provenance. */
export interface HistoryOrigin {
  principalId: string; policyVersion: string;
  navigation: { kind: 'known'; projectId: string | null; workspaceId: string | null } | { kind: 'unknown' };
}
export interface HistoryResourceDependency { kind: 'resource'; ref: ResourceRef; content?: { source: string; digest: string } }
export interface HistoryMessageDependency {
  kind: 'message'; conversationId: string; messageId: string; requestId: string;
  ordinal: number; contentDigest: string; provenanceDigest: string;
}
export type HistoryDependency = HistoryResourceDependency | HistoryMessageDependency;
export interface HistoryProvenance { schemaVersion: 1; dependencies: readonly HistoryDependency[]; digest: string }
export interface ProviderHistoryMessage {
  id: string; requestId: string; role: 'user' | 'assistant'; source: 'user' | 'provider';
  providerId?: string; classification: 'observed' | 'reported'; content: string; contentDigest: string;
}
export interface ProviderHistory { schemaVersion: 1; messages: readonly ProviderHistoryMessage[]; coverage: 'bounded-authorized-whole-messages' }
