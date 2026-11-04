/** Native-only GPT-Live integration. No key, SDP, or raw provider error is a view DTO. */
import type { NativeCredential } from './contracts.mts';
export const GPT_LIVE_MODEL = 'gpt-live-1' as const;
export type LiveVoice = string | { readonly id: string; readonly description?: string };
export interface LiveCanonicalContext {
  conversationId: string; contextRef: string; contextDigest: string;
  identity: { id: 'system:vela'; version: string; instructions: string };
  history: readonly { role: 'user' | 'assistant' | 'developer'; content: string }[];
  operationRefs: readonly string[];
  backendCapabilities: readonly string[];
  speechPersonality: string;
}
export interface LiveTranscriptFragment {
  sessionId: string; eventId: string; conversationId: string;
  role: 'user' | 'assistant'; delta: string; startMs: number; endMs: number;
  /** Transcript text is not a completed turn or proof of audible playback. */
  completedTurn: false; playback: 'unverified';
}
export interface LiveDelegationBinding {
  sessionId: string; delegationId: string; conversationId: string; configurationId: string;
  configurationVersion: number; contextRef: string; contextDigest: string; offsetMs: number;
}
export interface SavedPromptVoice {
  configurationId: string; configurationVersion: number;
  id: string; name: string; prompt: string; createdAt: number; type: 'prompt';
}
export interface CanonicalVelaRuntimePort {
  context(input: { conversationId: string; purpose: 'conversation' | 'audition' | 'delegation'; sessionId?: string; signal: AbortSignal }): Promise<LiveCanonicalContext>;
  validateContext(contextRef: string, contextDigest: string): Promise<void>;
  /** Must durably deduplicate by sessionId/eventId; this module retains no transcript. */
  receiveFragment(fragment: LiveTranscriptFragment): Promise<void>;
  /** Durable claim before work. Unknown prior effects never grant a fresh claim. */
  claimDelegation(binding: LiveDelegationBinding): Promise<'claimed' | 'duplicate' | 'unknown'>;
  /** Derive intent from canonical transcripts/state, never a provider event's task text.
   * Canonical runtime owns tool permissions, backend spend, operations and verification.
   * Aborting this projection wait is not authority to undo/cancel committed canonical work. */
  delegate(input: LiveDelegationBinding & { signal: AbortSignal }): Promise<{ state: 'verified' | 'failed' | 'unknown'; content?: string; receiptRef?: string }>;
  reconcile(input: { conversationId: string; previousAttemptId: string; previousSessionId?: string; signal: AbortSignal }): Promise<{ state: 'reconciled' | 'unknown'; reconciliationRef?: string }>;
  recordVoiceCandidate(voice: SavedPromptVoice): Promise<void>;
  saveVoiceSelection(input: { voice: SavedPromptVoice; expectedSettingsVersion: number; speechPersonality: string; authorizationRef: string }): Promise<{ settingsVersion: number }>;
}
export interface LiveStartInput {
  attemptId: string; configurationId: string; configurationVersion: number; conversationId: string;
  /** Private media negotiation input, excluded from state, receipts and errors. */
  sdpOffer: string; voice?: LiveVoice;
  /** Native wake coordinator only. No separate greeting model call. */
  wake?: { greeting: 'dynamic' | 'none'; pronunciation: 'VAY-luh' };
  authorizationRef: string;
  budget: { ref: string; maximumVoiceSeconds: number; initializationExposureSeconds: 15 };
}
export interface LiveNativeReview {
  operation: 'start' | 'audition' | 'reconnect' | 'delegate' | 'append' | 'mute' | 'voice-create' | 'voice-save';
  attemptId: string; configurationId: string; configurationVersion: number;
  authorizationRef: string; bodyDigest: string; bodyBytes: number;
  conversationId?: string; contextRef?: string; contextDigest?: string;
  identityVersion?: string; sessionId?: string; delegationId?: string;
  verificationRef?: string;
  budget?: LiveStartInput['budget']; reconciliationRef?: string;
  /** Creating a prompt voice is free; start/audition/reconnect incur session billing. */
  paidSession: boolean;
}
export interface LiveNativePort {
  /** Persist/consume exact native approval and spend reservation before dispatch. */
  authorize(review: LiveNativeReview): Promise<void>;
  resolveCredential(configurationId: string, expectedVersion: number): Promise<NativeCredential>;
  revalidate(review: LiveNativeReview, boundaryDigest: string): Promise<void>;
}
export type LiveClientCommand =
  | { type: 'session.input_audio.mute' | 'session.input_audio.unmute' | 'session.close'; event_id: string }
  | { type: 'session.thinking.append' | 'session.commentary.append'; event_id: string; delegation_id: string | null; content: string };
export interface LiveChannel {
  send(command: LiveClientCommand): Promise<void>;
  close(): Promise<void>;
}
export interface LiveMediaAdapter {
  /** Only this trusted media boundary receives SDP. It never receives an API key.
   * Native host must authenticate the event source; renderer booleans are not provider evidence. */
  connect(input: { sessionId: string; sdpAnswer: string; onEvent(event: unknown): Promise<void>; onConnectionLost(): void }): Promise<LiveChannel>;
}
export interface LiveSessionView {
  contract: 'aerynth.gpt-live-session@1'; model: typeof GPT_LIVE_MODEL;
  attemptId: string | null; sessionId: string | null; conversationId: string | null;
  configurationVersion: number | null;
  state: 'idle' | 'starting' | 'awaiting-start' | 'running' | 'closing' | 'closed' | 'unknown' | 'failed';
  dispatched: boolean; initializationExposureSeconds: 0 | 15;
  inputMute: 'unmuted' | 'mute-pending' | 'muted' | 'unmute-pending' | 'unknown';
  finalization: 'not-requested' | 'pending' | 'confirmed' | 'unconfirmed';
  /** Command acceptance, text production, and actual playback remain different observations. */
  lastAppend: 'none' | 'pending' | 'accepted' | 'rejected'; audioPlayback: 'unverified';
  transcriptFragments: number; backend: 'idle' | 'running' | 'unknown';
  usage: { seconds: number | null; source: 'provider-reported' | 'unavailable'; final: boolean };
  errorCode?: string;
}
export interface PromptVoiceInput {
  attemptId: string; configurationId: string; configurationVersion: number; authorizationRef: string;
  name: string; prompt: string; scriptHint?: string;
}
export interface PromptVoiceResult {
  state: 'created' | 'failed' | 'unknown'; dispatched: boolean; candidate?: SavedPromptVoice;
  savedLocally: boolean; selected: false; audioPreview: false; errorCode?: string;
}
