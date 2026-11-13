/** Browser-safe DTOs. No credentials, provider implementation or database ownership. */
export const PERSONAL_CONTEXT_CONTRACT = 'aerynth.personal-context/1' as const;
export type PersonalScope = { kind: 'user.shared' | 'assistant.ordinary' | 'assistant.vela' } | { kind: 'project' | 'conversation'; id: string };
export interface ScopeProof { scope: PersonalScope; version: string }
export type Category = 'identity' | 'preferences' | 'projects' | 'people' | 'technical' | 'decisions' | 'temporary' | 'conversation';
export type Certainty = 'explicit-statement' | 'user-preference' | 'imported-summary' | 'historical-observation' | 'inference' | 'conflicting' | 'unknown';
export type ConversationSourceRef = { kind: 'conversation-message'; conversationId: string; messageId: string };
export type ReviewedConversationSource = ConversationSourceRef & { version: string; contentDigest: string };
export type ConversationSourceProof = Omit<ConversationSourceRef, 'kind'> & {
  projectId: string | null; version: string; contentDigest: string; role: 'user' | 'assistant'; sensitive: boolean;
};
export type Provenance = { kind: 'user-statement' } | { kind: 'import'; id: string; version: number; contentDigest: string; start: number; end: number }
  | ReviewedConversationSource;
export type FactSource = { kind: 'user-statement' } | { kind: 'import'; id: string; version: number; start: number; end: number } | ReviewedConversationSource;
export interface OriginalInput { source: 'user-paste' | 'user-export'; kind: 'behavior' | 'memories'; scope: PersonalScope; text: string; sensitive: boolean; expiresAt: string | null }
export interface OriginalImport extends OriginalInput { id: string; version: number; state: 'active' | 'revoked'; createdAt: string; updatedAt: string; contentDigest: string }
export interface FactDraft { scope: PersonalScope; purpose: 'knowledge' | 'behavior'; category: Category; text: string; keywords: string[]; certainty: Certainty; sensitive: boolean; expiresAt: string | null; source: FactSource }
export interface ReviewedFact extends Omit<FactDraft, 'source'> { id: string; version: number; state: 'active' | 'revoked' | 'superseded'; createdAt: string; updatedAt: string; reviewedAt: string; reviewedBy: string; provenance: Provenance; supersededBy: string | null }
export interface PersonalPolicy { version: number; storageEnabled: boolean; ordinaryEnabled: boolean; velaEnabled: boolean; sharingEnabled: boolean; sensitiveEnabled: boolean }
export type PolicyPatch = Partial<Omit<PersonalPolicy, 'version'>>;
/** Values originate in a trusted host request, not permission booleans from a renderer. */
export interface ContextRequest {
  requestId: string; assistant: 'ordinary' | 'vela'; providerId: string; query: string;
  projectId: string | null; conversationId: string | null;
  sharedFactIds: string[]; includeBehavior: boolean; maxBytes: number; maxItems: number; maxScan?: number;
  /** Exact source messages resolved by the trusted context owner. */
  sourceAnchors?: ConversationSourceRef[];
  /** Bounded CIE search hints. These do not grant access or act as exact source anchors. */
  evidenceQueries?: string[];
}
export interface ContextItem {
  factId: string; version: number; scope: PersonalScope; purpose: ReviewedFact['purpose']; category: Category;
  text: string; certainty: Certainty; provenance: Provenance; reviewedAt: string;
}
export type OmissionReason = 'disabled' | 'outside-scope' | 'not-shared' | 'unavailable' | 'inactive' | 'expired' | 'sensitive-disabled' | 'source-changed' | 'irrelevant' | 'unmatched-evidence-query' | 'scan-limit' | 'byte-budget' | 'item-budget';
export interface PersonalContextManifest {
  contract: typeof PERSONAL_CONTEXT_CONTRACT; id: string; createdAt: string;
  ownerId: string; hostPolicyVersion: string; policyVersion: number; requestDigest: string;
  /** Imported text is data. Consumers must preserve their trusted operating instructions. */
  trust: 'untrusted-personalization-data'; scopes: ScopeProof[]; items: ContextItem[];
  omissions: { reason: OmissionReason; count: number }[]; encodedBytes: number; digest: string;
}
export interface RecordRef { id: string; version: number; kind: 'import' | 'fact'; scope: PersonalScope }
export type Operation = 'policy.read' | 'policy.write' | 'import.write' | 'fact.review' | 'record.list' | 'record.read' | 'record.revoke' | 'record.export' | 'record.delete' | 'source.erase' | 'context.preview' | 'context.disclose';
export interface PersonalAuthorization {
  operation: Operation; ownerId: string; scope: PersonalScope | null; subject: RecordRef | null;
  request?: ContextRequest; manifestDigest?: string; references?: RecordRef[];
  conversationSource?: ConversationSourceRef;
}
export interface PersonalContextHost {
  identity(): { userId: string; policyVersion: string };
  /** Must verify current canonical project/conversation identity, version and read access. */
  resolveScope(scope: PersonalScope): ScopeProof | null;
  /** Resolve the current accessible canonical message. Do not return message text. */
  resolveConversationSource?(reference: ConversationSourceRef): ConversationSourceProof | null;
  /** Trusted in-process policy / native disclosure grant. Renderer flags cannot grant authority. */
  authorize(input: PersonalAuthorization): { decision: 'allow'; policyVersion: string; authorizationRef: string } | { decision: 'deny' };
}
export interface PersonalCrypto {
  /** Native encryption with the key outside SQLite; false/throw fails closed. No plaintext fallback. */
  available(): boolean;
  encrypt(plaintext: Uint8Array, purpose: string): Uint8Array;
  decrypt(ciphertext: Uint8Array, purpose: string): Uint8Array;
}
export interface PersonalExport { contract: typeof PERSONAL_CONTEXT_CONTRACT; ownerId: string; exportedAt: string; records: { kind: 'import' | 'fact'; revisions: (OriginalImport | ReviewedFact)[] }[] }
