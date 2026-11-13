/** Browser-safe product contracts; IDs always refer to the canonical application. */
import type { NativeChatGPTFidelityDescriptor } from './native-chatgpt-fidelity.ts';
import type { PublicConversationExecution } from '../../application-contract/contracts.ts';
import type { OrdinaryModelOption, ReasoningEffort } from '../../openai-provider/model-controls.ts';
import type { CaptureConversationReply, ReplyNoteReceipt } from '../../block-library/note-contracts.ts';
export type { FidelityStatus, NativeChatGPTAimId, NativeChatGPTAimAssessment, NativeChatGPTFidelityDescriptor } from './native-chatgpt-fidelity.ts';
export type SharingMode = 'independent' | 'connected' | 'collaborative';
export type Evidence = 'excerpt' | 'reported' | 'observed' | 'hypothesis' | 'decision' | 'disputed';
export type ConversationSort = 'activity' | 'created' | 'title' | 'active';
export type ConversationSearchMode = 'conversations' | 'messages' | 'chat-history' | 'resources' | 'all';
export type SearchQuery = { text?: string; projectId?: string | null; collectionId?: string; familyOf?: string; providerId?: string; favorite?: boolean; archived?: boolean; after?: string; before?: string; sort?: ConversationSort; searchMode?: ConversationSearchMode; offset?: number; limit?: number };
export type ConversationSummary = { resourceId: string; conversationId: string; title: string; providerId: string; revision: number; version: number; projectId: string | null; projectIds: string[]; state: 'active' | 'archived'; createdAt: string; lastActivityAt?: string | null; historyMetadataStatus?: 'complete' | 'limited' | 'unavailable'; execution?: PublicConversationExecution; favorite: boolean; messageCount: number | null; collectionIds: string[] };
export type MessageView = { id: string; resourceId: string; role: string; content: string; createdAt: string; provenance: string; inherited: boolean; sensitivity: string;executionId?:string;outputState?:'complete'|'partial'; webSearch?: import('../../openai-provider/contracts.mts').TurnResult['webSearch'] };
export type SearchHit = { kind: 'conversation' | 'message' | 'resource'; resourceId: string; messageId?: string; title: string; excerpt: string; sourceTime?: string; providerId?:string; summary?:ConversationSummary };
export type Page<T> = { items: T[]; total: number; offset: number; limit: number; hasMore: boolean };
export type Collection = { id: string; title: string; projectId: string | null; version: number; ruleRevision: number; state: string; parentId: string | null; rule: SearchQuery | null; memberIds: string[]; pinnedIds: string[] };
export type BranchPolicy = { resourceId: string; revision: number; mode: SharingMode; allowedSourceIds: string[]; allowCrossProject: boolean; maxSensitivity: 'public' | 'internal' | 'sensitive'; categories: Evidence[] };
export type Share = { id: string; sourceResourceId: string; sourceMessageId: string; sourceTime: string; digest: string; range: { start: number; end: number }; evidence: Evidence; createdAt: string; status: 'current' | 'stale' | 'revoked' | 'unavailable' | 'superseded'; supersedes: string | null; supersededBy: string[]; state: 'discoverable' | 'inspected' | 'attached' | 'sent'; attached: boolean; content?: string; targetResourceId?: string; executionId?: string };
export type ProviderCapability = { id: string; label: string; available: boolean; record: boolean; execute: boolean; nativeFork: boolean; history: 'local' | 'unavailable'; reason?: string; reasonCode?: string; simulated: boolean; models: string[]; modelOptions?: OrdinaryModelOption[];default?:boolean;catalogOnly?:true; /** Documentation support is separate from the runtime booleans above. */ accountFidelity?: NativeChatGPTFidelityDescriptor };
export type Detail = { conversation: ConversationSummary & {messageCount:number}; messages: Page<MessageView>; lineage: { id: string; parentResourceId: string; childResourceId: string; sourceMessageId: string; mode: string; createdAt: string }[]; policy: BranchPolicy; shares: Share[]; providers: ProviderCapability[] };
/** Unsent local text. Its revision is independent from the canonical transcript. */
export type DraftDocumentRef = { id: string; version: number };
export type DraftDocument = DraftDocumentRef & { title: string; unavailable?: 'changed' | 'inaccessible' };
export type ConversationDraft = { resourceId: string; version: number; content: string; updatedAt: string | null; documents?: DraftDocument[] };
export const CONVERSATION_DRAFT_LIMITS = { contentUnits: 16384, contentBytes: 65536, aggregateBytes: 8 * 1024 * 1024, records: 4096 } as const;
/** Local recovery metadata only. No draft text, transcript, provider or title copy. */
export type ConversationViewPosition = { conversationRevision:number;anchor:{messageId:string;offsetY:number}|null };
export type ConversationViewSelection = { draftVersion:number;start:number;end:number;direction:'forward'|'backward'|'none' };
export type ConversationViewSelected = { version:number;resourceId:string|null;updatedAt:string|null };
export type ConversationView = { resourceId:string;version:number;position:ConversationViewPosition|null;selection:ConversationViewSelection|null;positionStatus:'none'|'current'|'anchor-revalidated'|'unavailable';selectionStatus:'none'|'current'|'draft-changed';updatedAt:string|null };
export type ConversationViewState = { contract:'aerynth.conversation-view@1';selected:ConversationViewSelected;view:ConversationView|null };
export const CONVERSATION_VIEW_LIMITS = { records:4096,entryBytes:2048,aggregateBytes:2*1024*1024,idUnits:256,offsetY:1000000 } as const;
export type CanonicalOrganizationCommand =
 | { type: 'createCollection'; title: string; projectId: string | null }
 | { type: 'renameCollection'; collectionId: string; title: string; expectedVersion: number }
 | { type: 'archiveCollection'; collectionId: string; archived: boolean; expectedVersion: number }
 | { type: 'membership'; collectionId: string; resourceId: string; member: boolean; expectedVersion: number }
 | { type: 'renameConversation'; resourceId: string; title: string; expectedRevision: number; expectedVersion: number }
 | { type: 'associateProject'; resourceId: string; projectId: string | null; expectedVersion: number };
export interface ProductCommandMap {
 list: { input: SearchQuery & { runningOnly?: boolean }; output: Page<ConversationSummary> };
 search: { input: SearchQuery; output: Page<SearchHit> };
 detail: { input: { resourceId: string; offset?: number; limit?: number; aroundMessageId?: string }; output: Detail };
 readDraft: { input: { resourceId: string }; output: ConversationDraft };
 saveDraft: { input: { resourceId: string; expectedVersion: number; content: string; documents?: DraftDocumentRef[] }; output: ConversationDraft };
 readViewState: {input:{resourceId?:string};output:ConversationViewState};
 saveViewState: {input:{resourceId:string;expectedVersion:number;position:ConversationViewPosition|null;selection:ConversationViewSelection|null};output:ConversationView};
 selectView: {input:{expectedVersion:number;resourceId:string|null};output:ConversationViewSelected};
 collections: { input: Record<string, never>; output: Collection[] };
 projects: { input: Record<string, never>; output: { id: string; title: string; version: number }[] };
 organize: { input: CanonicalOrganizationCommand; output: unknown };
 collectionRule: { input: { collectionId: string; parentId: string | null; rule: SearchQuery | null; expectedVersion: number; expectedRuleRevision: number }; output: Collection[] };
 favorite: { input: { resourceId: string; favorite: boolean }; output: boolean };
 create: { input: { title?: string; providerId?: string; commandId: string }; output: { resourceId: string } };
 archive: { input: { resourceId: string; archived: boolean; expectedVersion: number }; output: unknown };
 send: { input: { resourceId: string; content: string; expectedRevision: number; commandId: string; draftVersion?: number; model?: string; reasoningEffort?: ReasoningEffort; webSearch?: true; documents?: { id: string; version: number }[] }; output: unknown };
 openCitation: { input: { resourceId: string; messageId: string; index: number }; output: { requested: true } };
 captureReplyNote: { input: CaptureConversationReply; output: ReplyNoteReceipt };
 branch: { input: { resourceId: string; messageId: string; includeMessageIds: string[]; providerId: string; title: string; commandId: string; tokenBudget: number; expectedRevision: number }; output: { resourceId: string; handoffId: string; fingerprint: string; mode: string } };
 reviewBranch: { input: { handoffId: string; fingerprint: string; approve: boolean }; output: unknown };
 policy: { input: Omit<BranchPolicy, 'revision'> & { expectedRevision: number }; output: BranchPolicy };
 publish: { input: { sourceResourceId: string; sourceMessageId: string; range?: { start: number; end: number }; evidence: Evidence; allowSensitive?: boolean; supersedes?: string }; output: Share };
 discover: { input: { resourceId: string; text?: string }; output: Share[] };
 inspectShare: { input: { resourceId: string; shareId: string }; output: Share };
 attachShare: { input: { resourceId: string; shareId: string; attach: boolean }; output: Share };
 revokeShare: { input: { shareId: string }; output: null };
 providers: { input: Record<string, never>; output: ProviderCapability[] };
 selectProvider: { input: { resourceId: string; providerId: string; expectedRevision: number }; output: unknown };
 export: { input: { resourceId: string }; output: { format: 'aerynth.conversation-export@1'; detail: Detail } };
}
export interface ConversationProductPort { command<K extends keyof ProductCommandMap>(name: K, input: ProductCommandMap[K]['input']): Promise<ProductCommandMap[K]['output']> }
/** Register these deterministic abilities with Vela; Vela is not a provider alias. */
export const VELA_CONVERSATION_CAPABILITIES = ['list', 'search', 'detail', 'collections', 'organize', 'favorite', 'branch', 'policy', 'discover', 'inspectShare', 'attachShare'] as const;
