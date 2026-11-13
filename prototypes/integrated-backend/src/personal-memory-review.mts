import { createHash, randomUUID } from 'node:crypto';
import { containsRecognizableMemoryCredential } from '../../application-contract/personal-memory.ts';
import type { MemoryCaptureRequest as CaptureRequest } from '../../application-contract/personal-memory.ts';
export type { MemoryCaptureRequest as CaptureRequest } from '../../application-contract/personal-memory.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { ConversationSourceRef, FactDraft, PersonalAuthorization, PersonalContextHost, PersonalPolicy, ScopeProof, ReviewedFact, RecordRef } from '../../personal-context/src/contracts.ts';
import { PersonalContextError, type PersonalContextService } from '../../personal-context/src/service.mts';

type SourceReader = Required<Pick<PersonalContextHost, 'resolveConversationSource' | 'resolveScope'>>;
interface Options extends SourceReader {
  open(): Promise<PersonalContextService>;
  readSourceText(reference: ConversationSourceRef): string | null;
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

export type ManagementRequest = { action: 'correct' | 'revoke' | 'delete' | 'export'; id: string; version: number; text?: string; keywords?: readonly string[] };
export type ManagementReview = ManagementRequest & { ticket: string; fact: ReviewedFact | null; target: RecordRef; expiresAt: string };

const validKeywords = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= 16 &&
  value.every(keyword => typeof keyword === 'string' && keyword.trim() && keyword.length <= 64) &&
  new Set(value).size === value.length;

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 200 && value.trim().length > 0 && !/[\x00-\x1f]/.test(value);

/** Private owned-host interface. Only native review may call commitCapture;
 * a renderer-facing capture request must never forward directly to commit. */
export function createPersonalMemoryReview(options: Options) {
  const now = options.now ?? Date.now;
  const pending = new Map<string, { review: CaptureReview; expires: number; projectId: string | null }>();
  const management = new Map<string, ManagementReview>();
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
  function eligibleCaptureSource(reference: ConversationSourceRef) {
    const source = options.resolveConversationSource(reference);
    if (!source || source.role !== 'user' || source.sensitive ||
      source.conversationId !== reference.conversationId || source.messageId !== reference.messageId)
      throw new PersonalContextError('conversation_source_unavailable');
    return source;
  }

  function requireSameCaptureSource(source: ReturnType<typeof eligibleCaptureSource>,
    expected: Pick<ReturnType<typeof eligibleCaptureSource>, 'projectId' | 'version' | 'contentDigest'>) {
    if (source.projectId !== expected.projectId || source.version !== expected.version || source.contentDigest !== expected.contentDigest)
      throw new PersonalContextError('stale_personal_memory_source');
  }

  return {
    authorize: (input: PersonalAuthorization) => !closed && permission?.(input) === true,
    withSourceErasure<T>(source: ConversationSourceRef, erase: () => T): T {
      requireOpen();
      return withPermission(input => (input.operation === 'source.erase' || input.operation === 'record.delete' && input.subject?.kind === 'fact') &&
        input.conversationSource?.conversationId === source.conversationId && input.conversationSource.messageId === source.messageId, erase);
    },
    /** Called only after the native owner approves this setting change. */
    async setProviderUse(assistant: 'ordinary' | 'vela', enabled: boolean, expectedVersion: number) {
      requireOpen();
      if (!['ordinary', 'vela'].includes(assistant) || typeof enabled !== 'boolean')
        throw new PersonalContextError('invalid_privacy_policy');
      const service = await options.open();
      requireOpen();
      const patch = assistant === 'ordinary' ? { ordinaryEnabled: enabled } : { velaEnabled: enabled };
      return options.transaction(() => withPermission(input => input.operation === 'policy.read' || input.operation === 'policy.write', () => {
        const current = service.policy();
        if (current.version !== expectedVersion) throw new PersonalContextError('stale_personal_context_version');
        if (enabled && !current.storageEnabled) throw new PersonalContextError('personal_storage_disabled');
        return service.setPolicy({ expectedVersion, patch });
      }));
    },
    async pauseStorage(expectedVersion: number) {
      requireOpen();
      const service = await options.open();
      requireOpen();
      return withPermission(input => input.operation === 'policy.write', () => service.setPolicy({
        expectedVersion, patch: { storageEnabled: false, ordinaryEnabled: false, velaEnabled: false },
      }));
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
    /** Called inside the source owner's transaction. */
    activeFactForSourceRevocation(service: PersonalContextService, id: string, version: number) {
      requireOpen();
      const target = withPermission(input => input.operation === 'record.list' && input.subject?.id === id,
        () => service.describeFact(id));
      if (target.version !== version || target.state !== 'active')
        throw new PersonalContextError('stale_personal_context_version');
      return withPermission(input => input.operation === 'record.read' && input.subject?.id === id,
        () => service.readFact(id));
    },
    async previewManagement(input: ManagementRequest): Promise<ManagementReview> {
      requireOpen();
      if (!input || !identifier(input.id) || !Number.isSafeInteger(input.version) || input.version < 1 ||
        !['correct', 'revoke', 'delete', 'export'].includes(input.action) ||
        (input.action === 'correct' ? typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096 : input.text !== undefined) ||
        (input.keywords !== undefined && (input.action !== 'correct' || !validKeywords(input.keywords))))
        throw new PersonalContextError('invalid_personal_memory_management');
      const { action, id, version, text, keywords } = structuredClone(input);
      if (action === 'correct' && (containsRecognizableMemoryCredential(text!) || keywords?.some(containsRecognizableMemoryCredential)))
        throw new PersonalContextError('personal_memory_credential_detected');
      const service = await options.open();
      requireOpen();
      return options.transaction(() => {
        const target = withPermission(request => request.operation === 'record.list' && request.subject?.id === id,
          () => service.describeFact(id));
        if (target.version !== version || (action === 'correct' || action === 'revoke') && target.state !== 'active')
          throw new PersonalContextError('stale_personal_context_version');
        const fact = action === 'delete' || action === 'revoke' ? null : withPermission(request =>
          request.operation === 'record.read' && request.subject?.id === id, () => service.readFact(id));
        const timestamp = now();
        for (const [key, entry] of management) if (Date.parse(entry.expiresAt) <= timestamp) management.delete(key);
        if (management.size >= 16) throw new PersonalContextError('personal_memory_review_busy');
        const review = { action, id, version, ...(text === undefined ? {} : { text }), ...(keywords ? { keywords } : {}), fact, target,
          ticket: randomUUID(), expiresAt: new Date(timestamp + 300_000).toISOString() };
        management.set(review.ticket, structuredClone(review));
        return review;
      });
    },
    async commitManagement(review: ManagementReview) {
      requireOpen();
      const approved = management.get(review?.ticket);
      if (!approved || JSON.stringify(approved) !== JSON.stringify(review))
        throw new PersonalContextError('personal_memory_review_mismatch');
      management.delete(approved.ticket);
      const service = await options.open();
      requireOpen();
      if (Date.parse(approved.expiresAt) <= now()) throw new PersonalContextError('personal_memory_review_mismatch');
      const { id, version, action } = approved;
      const expected = { id, expectedVersion: version };
      return options.transaction(() => {
        const target = withPermission(request => request.operation === 'record.list' && request.subject?.id === id,
          () => service.describeFact(id));
        if (target.version !== version) throw new PersonalContextError('stale_personal_context_version');
        if (action === 'delete') {
          withPermission(request => request.operation === 'record.delete' && request.subject?.id === id,
            () => service.hardDelete(expected));
          return { action, id };
        }
        if (action === 'revoke') {
          withPermission(request => request.operation === 'record.revoke' && request.subject?.id === id,
            () => service.revoke(expected));
          return { action, id };
        }
        if (action === 'export') {
          const bundle = withPermission(request => request.operation === 'record.export' && request.subject?.id === id,
            () => service.export({ ids: [id], maxBytes: 524288 }));
          return { action, id, bundle };
        }
        const { scope, purpose, category, keywords, certainty, sensitive, expiresAt, provenance, text } = approved.fact!;
        const correctedCertainty = provenance.kind === 'conversation-message' && approved.text !== text
          ? 'user-reviewed-summary' : certainty;
        const source = provenance.kind === 'import'
          ? { kind: 'import' as const, id: provenance.id, version: provenance.version, start: provenance.start, end: provenance.end }
          : provenance;
        const corrected = withPermission(request =>
          request.operation === 'record.read' && (request.subject?.id === id || source.kind === 'import' && request.subject?.id === source.id) ||
          request.operation === 'fact.review' && (request.subject?.id === id || request.subject === null) &&
            JSON.stringify(request.scope) === JSON.stringify(scope),
        () => service.correctFact({ ...expected, replacement: { scope, purpose, category, keywords: [...(approved.keywords ?? keywords)], certainty: correctedCertainty, sensitive,
          expiresAt, source, text: approved.text! } }));
        return { action, id: corrected.replacement.id };
      });
    },
    cancelManagement(ticket: string) { management.delete(ticket); },
    async previewCapture(input: CaptureRequest): Promise<CaptureReview> {
      requireOpen();
      if (!input || !identifier(input.conversationId) || !identifier(input.messageId) ||
        !['conversation', 'project'].includes(input.scope) || !['preferences', 'projects', 'technical', 'decisions'].includes(input.category) ||
        typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096 ||
        (input.expectedProjectId !== undefined && input.expectedProjectId !== null && !identifier(input.expectedProjectId)) ||
        (input.expectedSourceText !== undefined && (typeof input.expectedSourceText !== 'string' || Buffer.byteLength(input.expectedSourceText) > 16384)) ||
        !Array.isArray(input.keywords) || !input.keywords.length || input.keywords.length > 16 ||
        !input.keywords.every(keyword => typeof keyword === 'string' && keyword.trim() && keyword.length <= 64) ||
        new Set(input.keywords).size !== input.keywords.length) throw new PersonalContextError('invalid_personal_memory_capture');
      const { conversationId, messageId, scope, category, text, keywords, expectedProjectId, expectedSourceText } = structuredClone(input);
      const expectedDigest = expectedSourceText === undefined ? undefined : createHash('sha256').update(expectedSourceText).digest('hex');
      const reference = { kind: 'conversation-message', conversationId, messageId } as const;
      const { original, sourceText } = options.transaction(() => {
        const source = eligibleCaptureSource(reference);
        if ((expectedProjectId !== undefined && source.projectId !== expectedProjectId) ||
          (expectedDigest !== undefined && source.contentDigest !== expectedDigest))
          throw new PersonalContextError('stale_personal_memory_source');
        const sourceText = options.readSourceText(reference);
        if (sourceText === null || Buffer.byteLength(sourceText) > 16384 ||
          createHash('sha256').update(sourceText).digest('hex') !== source.contentDigest)
          throw new PersonalContextError('conversation_source_unavailable');
        return { original: { ...source }, sourceText };
      });
      const service = await options.open();
      requireOpen();
      return options.transaction(() => {
        const source = eligibleCaptureSource(reference);
        requireSameCaptureSource(source, original);
        const scopeId = scope === 'project' ? source.projectId : conversationId;
        const proof = scopeId ? options.resolveScope({ kind: scope, id: scopeId }) : null;
        if (!proof) throw new PersonalContextError('canonical_scope_unavailable');
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
        pending.set(review.id, { review: structuredClone(review), expires, projectId: source.projectId });
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
        const original = approved.draft.source;
        if (original.kind !== 'conversation-message') throw new PersonalContextError('personal_memory_review_mismatch');
        requireSameCaptureSource(eligibleCaptureSource(original), { ...original, projectId: pendingReview.projectId });
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
    close() { closed = true; pending.clear(); management.clear(); },
  };
}
