import { createHash, randomUUID } from 'node:crypto';
import type { MemoryCaptureRequest as CaptureRequest } from '../../application-contract/personal-memory.ts';
export type { MemoryCaptureRequest as CaptureRequest } from '../../application-contract/personal-memory.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { ContextRequest, ConversationSourceRef, FactDraft, PersonalAuthorization, PersonalContextHost, PersonalPolicy, ScopeProof } from '../../personal-context/src/contracts.ts';
import type { TurnInput } from '../../openai-provider/contracts.mts';
import { attachPersonalMemory } from './personal-memory-prompt.mts';
import { PersonalContextError, type PersonalContextService } from '../../personal-context/src/service.mts';

type SourceReader = Required<Pick<PersonalContextHost, 'resolveConversationSource' | 'resolveScope'>>;
interface Options extends SourceReader {
  open(): Promise<PersonalContextService>;
  readSourceText(reference: ConversationSourceRef): string | null;
  resolveRecallTarget?(id: string): { projectId: string | null } | null;
  transaction<T>(work: (db: DatabaseSync) => T): T;
  now?: () => number;
}

export interface CaptureReview {
  id: string;
  draft: FactDraft;
  sourceText: string;
  scopeProof: ScopeProof;
  policy: PersonalPolicy;
  enableStorage: boolean;
  expiresAt: string;
}

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 200 && value.trim().length > 0 && !/[\x00-\x1f]/.test(value);

/** Private owned-host interface. Only native review may call commitCapture;
 * a renderer-facing capture request must never forward directly to commit. */
export function createPersonalMemoryReview(options: Options) {
  const now = options.now ?? Date.now;
  const pending = new Map<string, { review: CaptureReview; expires: number }>();
  let permission: ((input: PersonalAuthorization) => boolean) | undefined;
  let closed = false;

  function requireOpen() {
    if (closed) throw new PersonalContextError('personal_memory_closed');
  }
  function withPermission<T>(allowed: (input: PersonalAuthorization) => boolean, work: () => T): T {
    if (permission) throw new PersonalContextError('personal_memory_review_busy');
    permission = allowed;
    try { return work(); }
    finally { permission = undefined; }
  }

  return {
    authorize: (input: PersonalAuthorization) => !closed && permission?.(input) === true,
    /** Called only after the native owner approves this setting change. */
    async setProviderUse(assistant: 'ordinary' | 'vela', enabled: boolean, expectedVersion: number) {
      requireOpen();
      if (!['ordinary', 'vela'].includes(assistant) || typeof enabled !== 'boolean')
        throw new PersonalContextError('invalid_privacy_policy');
      const service = await options.open();
      requireOpen();
      const patch = assistant === 'ordinary' ? { ordinaryEnabled: enabled } : { velaEnabled: enabled };
      return withPermission(input => input.operation === 'policy.write',
        () => service.setPolicy({ expectedVersion, patch }));
    },
    async prepareOrdinaryRecall(conversationId: string, turn: TurnInput) {
      requireOpen();
      const exactTurn = structuredClone(turn);
      const query = exactTurn.messages.at(-1);
      if (turn.webSearch || turn.assistant !== 'ordinary' || turn.providerId !== 'chatgpt-plan-responses' ||
        query?.role !== 'user' || query.content.length > 4000) return null;
      const service = await options.open();
      requireOpen();
      return options.transaction(() => {
        const target = options.resolveRecallTarget?.(conversationId);
        if (!target) throw new PersonalContextError('canonical_scope_unavailable');
        const projectId = target.projectId;
        const request: ContextRequest = {
          requestId: exactTurn.requestId, assistant: 'ordinary', providerId: exactTurn.providerId,
          query: query.content, projectId, conversationId,
          sharedFactIds: [], includeBehavior: false, maxBytes: 4096, maxItems: 4,
        };
        const sameRequest = (input: PersonalAuthorization) => JSON.stringify(input.request) === JSON.stringify(request);
        const recordRead = (input: PersonalAuthorization) => input.operation === 'record.read';
        const manifest = withPermission(input => recordRead(input) || input.operation === 'context.preview' && sameRequest(input),
          () => service.previewContext(request));
        if (!manifest.items.length) return null;
        const attachment = attachPersonalMemory(exactTurn, request, manifest);
        const expires = now() + 300_000;
        let status: 'pending' | 'approved' | 'revoked' = 'pending';
        function requireCurrent() {
          requireOpen();
          if (now() >= expires || options.resolveRecallTarget?.(conversationId)?.projectId !== projectId)
            throw new PersonalContextError('stale_personal_context');
        }
        return {
          turn: attachment.turn,
          bodyDigest: attachment.bodyDigest,
          manifest: structuredClone(manifest),
          approve(bodyDigest: string) {
            requireCurrent();
            if (status !== 'pending') throw new PersonalContextError('personal_memory_disclosure_review_required');
            if (bodyDigest !== attachment.bodyDigest) throw new PersonalContextError('personal_memory_body_changed');
            status = 'approved';
          },
          validate(current: TurnInput) {
            requireCurrent();
            if (status !== 'approved') throw new PersonalContextError('personal_memory_disclosure_review_required');
            return withPermission(input => recordRead(input) || input.operation === 'context.disclose' &&
              sameRequest(input) && input.manifestDigest === manifest.digest, () => attachment.validate(service, current));
          },
          revoke() { status = 'revoked'; },
        };
      });
    },
    async inspect(page: { after: string | null; limit: number }) {
      requireOpen();
      const service = await options.open();
      requireOpen();
      return options.transaction(() => withPermission(input =>
        input.operation === 'policy.read' || input.operation === 'record.list' &&
          input.subject?.kind === 'fact' && input.scope !== null && !!options.resolveScope(input.scope), () => ({
        policy: service.policy(),
        ...service.list({ kind: 'fact', after: page.after, limit: page.limit }),
      })));
    },
    async read(id: string) {
      requireOpen();
      if (!identifier(id)) throw new PersonalContextError('invalid_record_id');
      const service = await options.open();
      requireOpen();
      return options.transaction(() => withPermission(input =>
        input.operation === 'record.read' && input.subject?.kind === 'fact' && input.subject.id === id,
      () => service.readFact(id)));
    },
    async previewCapture(input: CaptureRequest): Promise<CaptureReview> {
      requireOpen();
      if (!input || !identifier(input.conversationId) || !identifier(input.messageId) ||
        !['conversation', 'project'].includes(input.scope) || !['preferences', 'projects', 'technical', 'decisions'].includes(input.category) ||
        typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096 ||
        !Array.isArray(input.keywords) || !input.keywords.length || input.keywords.length > 16 ||
        !input.keywords.every(keyword => typeof keyword === 'string' && keyword.trim() && keyword.length <= 64) ||
        new Set(input.keywords).size !== input.keywords.length) throw new PersonalContextError('invalid_personal_memory_capture');
      const { conversationId, messageId, scope, category, text, keywords } = structuredClone(input);
      const service = await options.open();
      requireOpen();
      return options.transaction(() => {
        const reference = { kind: 'conversation-message', conversationId, messageId } as const;
        const source = options.resolveConversationSource(reference);
        if (!source || source.role !== 'user' || source.sensitive || source.conversationId !== conversationId || source.messageId !== messageId)
          throw new PersonalContextError('conversation_source_unavailable');
        const scopeId = scope === 'project' ? source.projectId : conversationId;
        const proof = scopeId ? options.resolveScope({ kind: scope, id: scopeId }) : null;
        if (!proof) throw new PersonalContextError('canonical_scope_unavailable');
        const sourceText = options.readSourceText(reference);
        if (sourceText === null || Buffer.byteLength(sourceText) > 16384 ||
          createHash('sha256').update(sourceText).digest('hex') !== source.contentDigest)
          throw new PersonalContextError('conversation_source_unavailable');
        const policy = withPermission(input => input.operation === 'policy.read', () => service.policy());
        const draft: FactDraft = {
          scope: proof.scope, purpose: 'knowledge', category, text, keywords: [...keywords],
          certainty: 'explicit-statement', sensitive: false, expiresAt: null,
          source: { ...reference, version: source.version, contentDigest: source.contentDigest },
        };
        const timestamp = now();
        for (const [id, entry] of pending) if (entry.expires <= timestamp) pending.delete(id);
        if (pending.size >= 16) throw new PersonalContextError('personal_memory_review_busy');
        const expires = timestamp + 300_000;
        const review = { id: randomUUID(), draft, sourceText, scopeProof: proof, policy, enableStorage: !policy.storageEnabled, expiresAt: new Date(expires).toISOString() };
        pending.set(review.id, { review: structuredClone(review), expires });
        return review;
      });
    },
    async commitCapture(review: CaptureReview) {
      requireOpen();
      const pendingReview = pending.get(review?.id);
      if (!pendingReview || pendingReview.expires <= now() || JSON.stringify(pendingReview.review) !== JSON.stringify(review))
        throw new PersonalContextError('personal_memory_review_mismatch');
      const approved = pendingReview.review;
      pending.delete(approved.id);
      const service = await options.open();
      requireOpen();
      if (pendingReview.expires <= now()) throw new PersonalContextError('personal_memory_review_mismatch');
      return options.transaction(() => {
        const current = options.resolveScope(approved.draft.scope);
        if (JSON.stringify(current) !== JSON.stringify(approved.scopeProof)) throw new PersonalContextError('stale_personal_scope');
        return withPermission(input => input.operation === 'policy.read' || input.operation === 'policy.write' && approved.enableStorage ||
          input.operation === 'fact.review' && input.subject === null && JSON.stringify(input.scope) === JSON.stringify(approved.draft.scope), () => {
          if (service.policy().version !== approved.policy.version) throw new PersonalContextError('stale_personal_context_version');
          if (approved.enableStorage) service.setPolicy({ expectedVersion: approved.policy.version, patch: { storageEnabled: true } });
          return service.reviewFact(approved.draft);
        });
      });
    },
    cancelCapture(id: string) { pending.delete(id); },
    close() { closed = true; pending.clear(); },
  };
}
