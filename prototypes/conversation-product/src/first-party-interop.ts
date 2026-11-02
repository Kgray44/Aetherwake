import { validateSubjectRef, type ResourceSubjectRef } from '../../workspace-kernel/subjects.ts';

/** Navigation only. These local technical IDs are not ChatGPT account conversation IDs. */
export interface LocalCodexThreadBinding {
  providerId: string;
  nativeThreadId: string;
  /** The native host must establish that the target app uses this same local installation. */
  installation: 'same-local' | 'different' | 'unverified';
}

export interface FirstPartyChatOpenTarget {
  readonly kind: 'open-local-codex-chat';
  readonly subject: Readonly<ResourceSubjectRef>;
  readonly nativeThreadId: string;
  readonly url: string;
}

export type FirstPartyChatUnavailableReason =
  | 'invalid_subject'
  | 'invalid_thread_id'
  | 'unsupported_provider'
  | 'installation_unverified'
  | 'unavailable';

export type FirstPartyChatPreparation =
  | { status: 'supported'; target: FirstPartyChatOpenTarget }
  | { status: 'unavailable'; reason: FirstPartyChatUnavailableReason };

/** OS request acknowledgement only; no status here proves foreground, continuation or sync. */
export type FirstPartyChatOpenReceipt =
  | { status: 'requested' }
  | { status: 'unavailable'; reason: FirstPartyChatUnavailableReason }
  | { status: 'unknown' };

/**
 * Implement in the trusted native host. This port conveys no grant and is not a security gate.
 * Do not expose native bindings through a renderer RPC merely to let the renderer build a URL.
 */
export interface FirstPartyChatNavigationHost {
  /** Check current canonical read access/provider/binding; never discover IDs from private app storage. */
  resolveLocalCodexThread(subject: Readonly<ResourceSubjectRef>): Promise<LocalCodexThreadBinding | null>;
  /**
   * Revalidate current canonical access, binding and same-local installation at dispatch, then
   * allow only the exact codex://threads/<technical-id> route through the native external-open gate.
   * A prepared target is untrusted input, not authorization. No automatic retry on unknown outcome.
   */
  requestOpen(target: FirstPartyChatOpenTarget): Promise<FirstPartyChatOpenReceipt>;
}

/** Official route contract: https://learn.chatgpt.com/docs/app/commands#deep-links */
export function prepareLocalCodexChatOpen(subject: unknown, binding: LocalCodexThreadBinding): FirstPartyChatPreparation {
  let canonical: ResourceSubjectRef;
  try {
    const parsed = validateSubjectRef(subject);
    if (parsed.kind !== 'resource') return { status: 'unavailable', reason: 'invalid_subject' };
    canonical = parsed;
  } catch {
    return { status: 'unavailable', reason: 'invalid_subject' };
  }
  if (!binding || binding.providerId !== 'codex-app-server') return { status: 'unavailable', reason: 'unsupported_provider' };
  if (binding.installation !== 'same-local') return { status: 'unavailable', reason: 'installation_unverified' };
  // One unreserved path segment only. "new" is a different, effectful route, never an existing ID.
  if (typeof binding.nativeThreadId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(binding.nativeThreadId) || binding.nativeThreadId.toLowerCase() === 'new') {
    return { status: 'unavailable', reason: 'invalid_thread_id' };
  }
  const target: FirstPartyChatOpenTarget = Object.freeze({
    kind: 'open-local-codex-chat',
    subject: Object.freeze({ ...canonical }),
    nativeThreadId: binding.nativeThreadId,
    url: `codex://threads/${encodeURIComponent(binding.nativeThreadId)}`,
  });
  return { status: 'supported', target };
}

/** Invoke only after an explicit user Open action; mounting/reading never calls the host. */
export function createFirstPartyChatInterop(host: FirstPartyChatNavigationHost) {
  return {
    async open(subject: ResourceSubjectRef): Promise<FirstPartyChatOpenReceipt> {
      // Validate before the resolver: a denied/invalid subject must not cause provider or app discovery.
      let canonical: ResourceSubjectRef;
      try {
        const parsed = validateSubjectRef(subject);
        if (parsed.kind !== 'resource') return { status: 'unavailable', reason: 'invalid_subject' };
        canonical = parsed;
      } catch {
        return { status: 'unavailable', reason: 'invalid_subject' };
      }
      const binding = await host.resolveLocalCodexThread(Object.freeze(canonical));
      if (!binding) return { status: 'unavailable', reason: 'unavailable' };
      const preparation = prepareLocalCodexChatOpen(canonical, binding);
      if (preparation.status !== 'supported') return preparation;
      return host.requestOpen(preparation.target);
    },
  };
}
