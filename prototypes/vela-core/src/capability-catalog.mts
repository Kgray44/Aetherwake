import { createHash } from 'node:crypto';
import { check, identifier, isRecord } from './capabilities.ts';
import type { CapabilityDescriptor } from './contracts.ts';
import { planningCapabilityCatalog, INLINE_CATALOG_DECODING } from './capability-encoding.mts';

export const CAPABILITY_CATALOG_CONTRACT = 'aerynth.vela.capability-catalog@1' as const;
export const CAPABILITY_SCHEMA_TOOL = 'aerynth_capability_schemas' as const;
export const CAPABILITY_DISCOVERY_LIMITS = Object.freeze({
  maxCalls: 8,
  maxIdsPerCall: 4,
  maxResponseBytes: 8192,
  maxTotalBytes: 32768,
  maxArgumentBytes: 2048,
});
export interface CapabilityCatalogProjection {
  contract: typeof CAPABILITY_CATALOG_CONTRACT;
  digest: string;
  index: Pick<CapabilityDescriptor, 'id' | 'label' | 'effect'>[];
}
export interface CapabilityDiscoveryDeclaration {
  mode: 'same-turn-readonly';
  catalogDigest: string;
  toolDigest: string;
  limits: typeof CAPABILITY_DISCOVERY_LIMITS;
}
export interface CapabilitySchemaQuery {
  catalogDigest: string;
  ids: CapabilityDescriptor['id'][];
}
export interface CapabilityNativeCall {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
}
export interface CapabilityToolReply {
  contentItems: { type: 'inputText'; text: string }[];
  success: boolean;
}
export interface CapabilityCatalogSnapshot {
  projection: CapabilityCatalogProjection;
  declaration: CapabilityDiscoveryDeclaration;
  descriptors: CapabilityDescriptor[];
}
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : isRecord(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, stable(value[key])]),
        )
      : value;
export const capabilityCatalogDigest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
export function capabilitySchemaTool(projection: CapabilityCatalogProjection) {
  return {
    type: 'function' as const,
    name: CAPABILITY_SCHEMA_TOOL,
    description:
      'Read exact Vela capability schemas, scope, effects and authorization from the pinned catalog. Reads no application resource content and performs no actions.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        catalogDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        ids: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { enum: projection.index.map((item) => item.id) } },
      },
      required: ['catalogDigest', 'ids'],
    },
  };
}
/** A request-local projection of the existing registry, never another registry or resource store. */
export function createCapabilityCatalog(available: readonly CapabilityDescriptor[]): CapabilityCatalogSnapshot {
  check(Array.isArray(available) && available.length > 0 && available.length <= 100, 'invalid_capability_catalog');
  const descriptors = structuredClone([...available]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  check(
    new Set(descriptors.map((item) => item.id)).size === descriptors.length &&
      descriptors.every(
        (item) =>
          identifier(item.id) &&
          isRecord(item.schema) &&
          identifier(item.authorization) &&
          identifier(item.effect) &&
          identifier(item.reversible) &&
          typeof item.scope === 'string',
      ),
    'invalid_capability_catalog',
  );
  check(bytes(descriptors) <= 65536, 'capability_catalog_capacity_exceeded');
  const projection: CapabilityCatalogProjection = {
    contract: CAPABILITY_CATALOG_CONTRACT,
    digest: capabilityCatalogDigest({ contract: CAPABILITY_CATALOG_CONTRACT, descriptors }),
    index: descriptors.map(({ id, label, effect }) => ({ id, label, effect })),
  };
  return {
    projection,
    descriptors,
    declaration: {
      mode: 'same-turn-readonly',
      catalogDigest: projection.digest,
      toolDigest: capabilityCatalogDigest(capabilitySchemaTool(projection)),
      limits: { ...CAPABILITY_DISCOVERY_LIMITS },
    },
  };
}
export function validateCatalogDeclaration(snapshot: CapabilityCatalogSnapshot, declaration: unknown) {
  check(capabilityCatalogDigest(snapshot.declaration) === capabilityCatalogDigest(declaration), 'capability_discovery_grant_mismatch');
}
export function capabilityToolFailure(code: string): CapabilityToolReply {
  return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ contract: CAPABILITY_CATALOG_CONTRACT, errorCode: code }) }] };
}

/** Only metadata is cached for a bounded, already-authorized execution. No capability can be executed here. */
export class CapabilityCatalogLease {
  private readonly snapshot: CapabilityCatalogSnapshot;
  private readonly replies = new Map<string, { fingerprint: string; reply: CapabilityToolReply }>();
  private readonly fetched = new Set<string>();
  private identity: { threadId: string; turnId: string } | null = null;
  private totalBytes = 0;
  private closed = false;
  private readonly options: { catalog: CapabilityCatalogSnapshot; expiresAt: string; authorize(): void; now?: () => number };
  constructor(options: { catalog: CapabilityCatalogSnapshot; expiresAt: string; authorize(): void; now?: () => number }) {
    this.options = options;
    this.snapshot = structuredClone(options.catalog);
  }
  bind(threadId: string, turnId: string) {
    check(!this.closed && identifier(threadId) && identifier(turnId), 'capability_discovery_identity_unavailable');
    check(!this.identity || (this.identity.threadId === threadId && this.identity.turnId === turnId), 'capability_discovery_identity_mismatch');
    this.identity = { threadId, turnId };
  }
  read(call: CapabilityNativeCall): CapabilityToolReply {
    let reserved: string | null = null;
    try {
      check(!this.closed && Date.parse(this.options.expiresAt) > (this.options.now?.() ?? Date.now()), 'capability_discovery_expired');
      this.options.authorize();
      check(this.identity && call.threadId === this.identity.threadId && call.turnId === this.identity.turnId, 'capability_discovery_identity_mismatch');
      check(identifier(call.callId) && call.namespace === null && call.tool === CAPABILITY_SCHEMA_TOOL, 'unsupported_capability_tool');
      const fingerprint = capabilityCatalogDigest(call),
        prior = this.replies.get(call.callId);
      if (prior) {
        check(prior.fingerprint === fingerprint, 'capability_discovery_duplicate_mismatch');
        return structuredClone(prior.reply);
      }
      check(this.replies.size < CAPABILITY_DISCOVERY_LIMITS.maxCalls, 'capability_discovery_call_budget_exceeded');
      // Reserve even invalid calls; an invalid schema is not a way around the call budget.
      this.replies.set(call.callId, { fingerprint, reply: capabilityToolFailure('invalid_capability_schema_query') });
      reserved = call.callId;
      check(bytes(call.arguments) <= CAPABILITY_DISCOVERY_LIMITS.maxArgumentBytes, 'capability_discovery_arguments_too_large');
      const query = call.arguments;
      check(
        isRecord(query) &&
          Object.keys(query).length === 2 &&
          Object.keys(query).every((key) => ['catalogDigest', 'ids'].includes(key)) &&
          query.catalogDigest === this.snapshot.projection.digest &&
          Array.isArray(query.ids) &&
          query.ids.length > 0 &&
          query.ids.length <= 4 &&
          query.ids.every(identifier) &&
          new Set(query.ids).size === query.ids.length,
        'invalid_capability_schema_query',
      );
      const descriptors = query.ids.map((id) => this.snapshot.descriptors.find((item) => item.id === id));
      check(descriptors.every(Boolean), 'capability_schema_unavailable');
      let reply: CapabilityToolReply = {
        success: true,
        contentItems: [
          {
            type: 'inputText',
            text: JSON.stringify({ contract: CAPABILITY_CATALOG_CONTRACT, catalogDigest: this.snapshot.projection.digest, capabilities: descriptors }),
          },
        ],
      };
      // Large exact schemas (including Clock & Timer) use the same lossless data codec
      // as inline planning. The pinned digest always identifies the original descriptors.
      if(bytes(reply)>CAPABILITY_DISCOVERY_LIMITS.maxResponseBytes)reply={success:true,contentItems:[{type:'inputText',text:JSON.stringify({
        contract:CAPABILITY_CATALOG_CONTRACT,catalogDigest:this.snapshot.projection.digest,decoding:INLINE_CATALOG_DECODING,
        ...planningCapabilityCatalog(descriptors as CapabilityDescriptor[]),
      })}]};
      const size = bytes(reply),
        failureReserve = 256 * (CAPABILITY_DISCOVERY_LIMITS.maxCalls - this.replies.size);
      check(
        size <= CAPABILITY_DISCOVERY_LIMITS.maxResponseBytes && this.totalBytes + size + failureReserve <= CAPABILITY_DISCOVERY_LIMITS.maxTotalBytes,
        'capability_discovery_output_budget_exceeded',
      );
      this.totalBytes += size;
      query.ids.forEach((id) => this.fetched.add(id));
      this.replies.set(call.callId, { fingerprint, reply });
      return structuredClone(reply);
    } catch (error) {
      const reply = capabilityToolFailure(isRecord(error) && typeof error.code === 'string' ? error.code : 'capability_discovery_denied');
      if (reserved) {
        this.totalBytes += bytes(reply);
        this.replies.get(reserved)!.reply = reply;
      }
      return reply;
    }
  }
  fetchedIds(): string[] {
    return [...this.fetched];
  }
  close() {
    this.closed = true;
  }
}
