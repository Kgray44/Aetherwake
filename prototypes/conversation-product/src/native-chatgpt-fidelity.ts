/** Browser-safe documentation evidence. This report never grants auth or changes provider availability. */
export type FidelityStatus = 'Supported' | 'Unsupported' | 'Unverified' | 'RequiresAdditionalAuthorization';

export const NATIVE_CHATGPT_AIM_IDS = Object.freeze([
  'same-account-auth', 'existing-chat-discovery', 'existing-chat-continuation', 'new-chat-creation',
  'web-desktop-sync', 'existing-chatgpt-projects', 'custom-instructions', 'account-memories',
  'personalization-settings', 'model-selection', 'usage-entitlements', 'chatgpt-vs-codex-identity',
  'cross-provider-handoffs',
] as const);
export type NativeChatGPTAimId = typeof NATIVE_CHATGPT_AIM_IDS[number];

export interface FidelityEvidence {
  readonly url: string;
  readonly section: string;
  readonly observation: 'explicit-exclusion' | 'documented-interface' | 'first-party-feature-only' | 'local-schema-only';
}
export interface NativeChatGPTAimAssessment {
  readonly id: NativeChatGPTAimId;
  readonly label: string;
  readonly status: FidelityStatus;
  /** Exact reviewed interface; Unsupported applies only to this interface and statusScope. */
  readonly interfaceName: string;
  readonly statusScope: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly evidence: readonly FidelityEvidence[];
  /** Explicit exclusions do not establish that every other native-account interface is impossible. */
  readonly otherNativeInterfaces?: { readonly status: 'Unverified'; readonly reasonCode: 'public_interface_not_established' };
}
export interface RelatedChatGPTCapability {
  readonly id: 'eligible-plan-responses-inference' | 'local-codex-navigation';
  readonly label: string;
  readonly status: FidelityStatus;
  readonly interfaceName: string;
  readonly statusScope: string;
  readonly implementation: 'on-hold' | 'in-progress' | 'source-tested-host-unwired';
  readonly reason?: string;
  readonly satisfiesNativeAccountFidelity: false;
  readonly evidence: readonly FidelityEvidence[];
}
export interface NativeChatGPTFidelityDescriptor {
  readonly id: 'openai.native-chatgpt-account-fidelity';
  readonly schemaVersion: 1;
  readonly providerId: 'chatgpt';
  readonly nativeAccountFidelity: 'not-established';
  readonly reasonCode: 'native_chatgpt_fidelity_not_established';
  readonly reason: string;
  readonly review: {
    readonly dateUtc: '2026-11-02';
    readonly evidenceTier: 'official-documentation-and-offline-schema';
    readonly runtimeAccountVerification: 'not-performed';
    readonly installedCli: 'codex-cli 0.153.3';
    readonly sourceManifest: 'chatgpt-fidelity-sources.json';
  };
  readonly statusDefinitions: Readonly<Record<FidelityStatus, string>>;
  readonly aims: readonly NativeChatGPTAimAssessment[];
  /** Deliberately outside the exact 13 native-account aims. */
  readonly relatedCapabilities: readonly RelatedChatGPTCapability[];
}

const overview = (observation: FidelityEvidence['observation'] = 'explicit-exclusion'): FidelityEvidence => ({ url: 'https://developers.openai.com/siwc/token-sharing-open-source', section: 'Introduction', observation });
const quickstart = (): FidelityEvidence => ({ url: 'https://developers.openai.com/siwc/quickstart', section: 'Understand scopes', observation: 'documented-interface' });
const preview = (): FidelityEvidence => ({ url: 'https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations', section: 'Responses API requirements', observation: 'explicit-exclusion' });
const appServer = (): FidelityEvidence => ({ url: 'https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/app-server/README.md', section: 'API Overview / Auth endpoints', observation: 'local-schema-only' });
const projects = (): FidelityEvidence => ({ url: 'https://learn.chatgpt.com/docs/projects?surface=app', section: 'Projects and chats / Use Quick chat for a quick question', observation: 'first-party-feature-only' });
const personalization = (): FidelityEvidence => ({ url: 'https://learn.chatgpt.com/docs/personalize', section: 'Add custom instructions / Manage personalization', observation: 'first-party-feature-only' });
const memories = (): FidelityEvidence => ({ url: 'https://learn.chatgpt.com/docs/customization/memories', section: 'Memories / How local Codex memories work', observation: 'first-party-feature-only' });
const models = (): FidelityEvidence => ({ url: 'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference', section: 'List available models / Call the Responses API', observation: 'documented-interface' });
const sessions = (): FidelityEvidence => ({ url: 'https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions', section: 'Managing ChatGPT accounts / Tracking usage', observation: 'documented-interface' });
const deepLinks = (): FidelityEvidence => ({ url: 'https://learn.chatgpt.com/docs/app/commands#deep-links', section: 'Deep links / Chats', observation: 'documented-interface' });
const otherNativeInterfaces = { status: 'Unverified', reasonCode: 'public_interface_not_established' } as const;
const siwc = 'Sign in with ChatGPT (identity and ChatGPT plan usage)';
const unverifiedInterface = 'Third-party ChatGPT-native account interface (not established)';

/** A fresh JSON-safe report per caller; no connection, account lookup, provider request or shared mutable cache. */
export function createNativeChatGPTFidelityDescriptor(): NativeChatGPTFidelityDescriptor {
  return {
    id: 'openai.native-chatgpt-account-fidelity', schemaVersion: 1, providerId: 'chatgpt',
    nativeAccountFidelity: 'not-established', reasonCode: 'native_chatgpt_fidelity_not_established',
    reason: 'Native ChatGPT account fidelity has not been established. Sign in with ChatGPT excludes existing chats and other account context; remaining native account interfaces are unverified.',
    review: { dateUtc: '2026-11-02', evidenceTier: 'official-documentation-and-offline-schema', runtimeAccountVerification: 'not-performed', installedCli: 'codex-cli 0.153.3', sourceManifest: 'chatgpt-fidelity-sources.json' },
    statusDefinitions: {
      Supported: 'The named documented interface supports only the stated scope; this is not runtime authorization or app availability.',
      Unsupported: 'The named interface explicitly excludes the stated scope. Other interfaces remain unverified, not proven impossible.',
      Unverified: 'No qualifying public interface was established by the reviewed sources; absence is not proof of impossibility.',
      RequiresAdditionalAuthorization: 'The documented route requires eligibility, consent and runtime verification; this does not make the app available or authorized.',
    },
    aims: [
      { id: 'same-account-auth', label: 'Same-account auth', status: 'RequiresAdditionalAuthorization', interfaceName: siwc,
        statusScope: 'Authenticate an existing ChatGPT account through a separate approved sign-in flow.', reasonCode: 'separate_account_authorization_required',
        reason: 'Identity sign-in is documented; this installation has not completed or verified its account/workspace grant. Another app login is not inherited.', evidence: [quickstart(), sessions()] },
      { id: 'existing-chat-discovery', label: 'Existing chat discovery', status: 'Unsupported', interfaceName: siwc,
        statusScope: 'Discover existing ChatGPT account conversations through SIWC scopes.', reasonCode: 'siwc_conversations_excluded',
        reason: 'Identity and plan usage do not grant existing ChatGPT conversations. Codex app-server thread/list lists its own stored threads.', evidence: [overview(), appServer()], otherNativeInterfaces: { ...otherNativeInterfaces } },
      { id: 'existing-chat-continuation', label: 'Existing chat continuation', status: 'Unsupported', interfaceName: siwc,
        statusScope: 'Read and append to an existing ChatGPT account chat through SIWC.', reasonCode: 'siwc_conversations_excluded',
        reason: 'The existing ChatGPT conversation is outside the grant. Local Codex thread/resume is a distinct interface and identity.', evidence: [overview(), appServer()], otherNativeInterfaces: { ...otherNativeInterfaces } },
      { id: 'new-chat-creation', label: 'NEW chat creation', status: 'Unverified', interfaceName: unverifiedInterface,
        statusScope: 'Create a durable ordinary ChatGPT account chat from Aerynth.', reasonCode: 'native_chat_creation_interface_unverified',
        reason: 'Responses inference is not a native account chat; the documented deep link creates a local chat. First-party Quick chat is a UI feature, not third-party creation authority.', evidence: [preview(), projects(), deepLinks()] },
      { id: 'web-desktop-sync', label: 'Web/desktop sync', status: 'Unverified', interfaceName: unverifiedInterface,
        statusScope: 'Synchronize native ChatGPT account history with Aerynth.', reasonCode: 'native_sync_interface_unverified',
        reason: 'First-party cloud sync is documented, but its public third-party synchronization contract was not established. SIWC does not supply persistent conversation storage.', evidence: [{ url: 'https://learn.chatgpt.com/docs/whats-new', section: 'Keep Work conversations and Projects together on desktop', observation: 'first-party-feature-only' }, preview()] },
      { id: 'existing-chatgpt-projects', label: 'Existing ChatGPT Projects', status: 'Unverified', interfaceName: unverifiedInterface,
        statusScope: 'Read or manage actual ChatGPT account Projects, files, instructions and membership.', reasonCode: 'native_projects_interface_unverified',
        reason: 'First-party ChatGPT Projects differ from local folder projects. Experimental app-server project/* is SQLite-backed and does not establish cloud Project access.', evidence: [projects(), appServer()] },
      { id: 'custom-instructions', label: 'Custom instructions', status: 'Unsupported', interfaceName: siwc,
        statusScope: 'Retrieve or synchronize ChatGPT account custom instructions through SIWC.', reasonCode: 'siwc_account_context_excluded',
        reason: 'Other account context is outside SIWC. Local Codex AGENTS.md cannot be presented as synchronized ChatGPT custom instructions.', evidence: [overview(), personalization()], otherNativeInterfaces: { ...otherNativeInterfaces } },
      { id: 'account-memories', label: 'Account memories', status: 'Unsupported', interfaceName: siwc,
        statusScope: 'Retrieve or synchronize actual ChatGPT account memories through SIWC.', reasonCode: 'siwc_account_context_excluded',
        reason: 'ChatGPT web memory and local Codex memory have separate stores and controls. Local recall or memory-mode RPCs do not grant ChatGPT account memories.', evidence: [overview(), memories()], otherNativeInterfaces: { ...otherNativeInterfaces } },
      { id: 'personalization-settings', label: 'Personalization settings', status: 'Unsupported', interfaceName: siwc,
        statusScope: 'Read or change native ChatGPT account personalization through SIWC.', reasonCode: 'siwc_account_context_excluded',
        reason: 'Account context is outside this grant. Local preferences or Codex personality are not native ChatGPT settings parity.', evidence: [overview(), personalization()], otherNativeInterfaces: { ...otherNativeInterfaces } },
      { id: 'model-selection', label: 'Model selection', status: 'Unverified', interfaceName: unverifiedInterface,
        statusScope: 'Reproduce the native ChatGPT model picker and all feature/tool entitlements.', reasonCode: 'native_model_parity_unverified',
        reason: 'A separately authorized SIWC GET /v1/models catalog describes eligible inference choices, not full native picker parity. App-server model/list may be cached; a catalog is not a successful turn.', evidence: [models(), appServer()] },
      { id: 'usage-entitlements', label: 'Usage entitlements', status: 'RequiresAdditionalAuthorization', interfaceName: 'SIWC ChatGPT plan usage / Codex app-server account/read and account/usage/read',
        statusScope: 'Documented route-specific plan/usage access; full native product entitlement parity remains unverified.', reasonCode: 'plan_usage_authorization_required',
        reason: 'Actual granted scopes, account/workspace, policy and live quota must be verified. No inference or generic API-billing fallback is authorized by this report.', evidence: [sessions(), appServer()], otherNativeInterfaces: { ...otherNativeInterfaces } },
      { id: 'chatgpt-vs-codex-identity', label: 'ChatGPT vs Codex identity', status: 'Supported', interfaceName: 'ChatGPT desktop Chat / Work / Codex identities; Aerynth canonical Codex binding',
        statusScope: 'Keep provider and canonical identities distinct, without asserting ordinary ChatGPT connectivity.', reasonCode: 'provider_identity_separation_supported',
        reason: 'Native Codex remains codex-app-server. Local recording and legacy mock-ordinary are not an authenticated ChatGPT account.', evidence: [{ url: 'https://learn.chatgpt.com/docs/use-chatgpt', section: 'Compare ChatGPT Work and Codex on desktop', observation: 'first-party-feature-only' }, appServer()] },
      { id: 'cross-provider-handoffs', label: 'CROSS-provider handoffs', status: 'Unverified', interfaceName: unverifiedInterface,
        statusScope: 'Authentic ChatGPT-account to/from Aerynth/Codex continuity with selective attributable context.', reasonCode: 'native_cross_provider_handoff_unverified',
        reason: 'First-party UI can add an existing ChatGPT chat to Codex. This does not establish a third-party source read/send grant or native shared state; existing Aerynth sharing does not merge account history.', evidence: [projects(), overview()] },
    ],
    relatedCapabilities: [
      { id: 'eligible-plan-responses-inference', label: 'Eligible ChatGPT-plan Responses inference', status: 'RequiresAdditionalAuthorization', interfaceName: 'SIWC POST https://api.openai.com/v1/responses', statusScope: 'Eligible inference only; not native account chat creation, history, memory or sync.', implementation: 'in-progress', reason: 'Implementation in progress; account authorization and live inference remain unverified.', satisfiesNativeAccountFidelity: false, evidence: [models(), preview()] },
      { id: 'local-codex-navigation', label: 'First-party local Codex chat navigation', status: 'Supported', interfaceName: 'ChatGPT desktop codex://threads/<technical-thread-id>', statusScope: 'Explicit native external-open request for a verified same-installation local Codex chat only.', implementation: 'source-tested-host-unwired', satisfiesNativeAccountFidelity: false, evidence: [deepLinks()] },
    ],
  };
}
