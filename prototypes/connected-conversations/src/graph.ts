import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export type Kind = 'ordinary' | 'codex';
export type Role = 'user' | 'assistant' | 'system';
export type Gate = 'available' | 'requires_auth' | 'disabled' | 'unsupported' | 'unknown';
export type Usage = 'included' | 'metered' | 'unknown';
export type HandoffState = 'ready' | 'failed' | 'interrupted';
export type Provenance = 'user' | 'mock_adapter' | 'application' | 'device_clock';
export type Sensitivity = 'public' | 'internal' | 'sensitive' | 'restricted';
export interface Capability { supported: boolean; authorized: boolean; availability: Gate }
export interface ModelOption { id: string; availability: Gate; usage: Usage; quota?: string; lastError?: string }
export interface ProviderSnapshot {
  id: string; label: string; version: string; mock: boolean;
  availability: Gate; chat: Capability; nativeFork: Capability;
  models: ModelOption[]; usage: Usage; observedAt: string;
}
export interface Conversation {
  id: string; kind: Kind; title: string; providerId: string;
  localSessionId: string; providerSessionId: string | null;
  createdAt: string; state: 'idle' | 'failed' | 'interrupted';
  ownMessageIds: string[];
}
export interface Message {
  id: string; conversationId: string; sequence: number; role: Role;
  content: string; provenance: Provenance; createdAt: string;
  referenceIds: string[]; constraint: boolean; sensitivity: Sensitivity; providerTurnId?: string;
}
export type MessageMetadata = Readonly<Pick<Message,'id'|'conversationId'|'sequence'|'role'|'sensitivity'> & {ordinal:number;bodyBytes:number;unavailable:boolean}>;
export interface MessageMetadataWindow {items:MessageMetadata[];emittedCount:number;emittedBodyBytes:number;hasMore:boolean;limitedBy:null|'scan-limit'|'byte-limit'|'denied'}
export type MessageSearchMatch = Readonly<Pick<Message, 'id' | 'createdAt'> & { excerpt: string }>;
class MetadataScanLimit extends Error {}
export interface Artifact {
  id: string; conversationId: string; sourceMessageId: string;
  label: string; uri: string; provenance: Provenance; createdAt: string;
}
export interface LineageEdge {
  id: string; parentId: string; childId: string; sourceMessageId: string;
  mode: 'native_fork' | 'application_continuation';
  handoffId: string; createdAt: string;
}
export interface ContextItem {
  sourceConversationId: string; sourceMessageId: string;
  sourceTime: string; content: string; digest: string;
  role: Role; provenance: Provenance; referenceIds: string[];
  constraint: boolean;
  sensitivity: Sensitivity;
}
export interface ContextPackage {
  id: string; targetConversationId: string; sourceConversationId: string;
  forkMessageId: string; createdAt: string; mode: LineageEdge['mode'];
  items: ContextItem[]; artifactIds: string[];
  excludedMessageIds: string[]; state: HandoffState; error?: string;
  suppliedAt?: string;
}
export interface GraphData {
  schemaVersion: number; counter: number; tick: number;
  providers: ProviderSnapshot[]; conversations: Conversation[];
  messages: Message[]; artifacts: Artifact[]; edges: LineageEdge[];
  handoffs: ContextPackage[]; unavailableMessageIds: string[];
  idempotency: Record<string, string>;
}
export interface SessionRequest {
  conversationId: string; parentProviderSessionId?: string | null; parentProviderTurnId?: string;
  context: ContextPackage | null;
}
export interface ProviderAdapter {
  snapshot: ProviderSnapshot;
  open(request: SessionRequest): { providerSessionId: string | null };
  fork?(request: SessionRequest): { providerSessionId: string | null };
  respond?(conversation: Conversation, prompt: string): string;
}
/** The sequence is the existing persisted observation counter, not elapsed time. */
export interface ConversationClock { now(sequence: number): string }
export interface ConversationGraphOptions { clock?: ConversationClock }
const wallClock: ConversationClock = { now: () => new Date().toISOString() };
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
const copy = <T>(value: T): T => structuredClone(value);
export class ConversationGraph {
  private data: GraphData;
  private adapters: Map<string, ProviderAdapter>;
  private readonly conversationsById: Map<string, Conversation>;
  private readonly messagesById: Map<string, Message>;
  private readonly edgesByChild: Map<string, LineageEdge>;
  private readonly unavailableMessages: Set<string>;
  private readonly clock: ConversationClock;
  constructor(adapters: ProviderAdapter[], imported?: GraphData, options: ConversationGraphOptions = {}) {
    this.clock = options.clock ?? wallClock;
    assert(typeof this.clock.now === 'function', 'invalid conversation clock');
    this.adapters = new Map(adapters.map(a => [a.snapshot.id, a]));
    assert(this.adapters.size === adapters.length, 'duplicate adapter');
    this.data = imported ? copy(imported) : {
      schemaVersion: SCHEMA_VERSION, counter: 0, tick: 0,
      providers: adapters.map(a => copy(a.snapshot)), conversations: [], messages: [],
      artifacts: [], edges: [], handoffs: [], unavailableMessageIds: [], idempotency: {}
    };
    this.validate();
    this.conversationsById = new Map(this.data.conversations.map(c => [c.id, c]));
    this.messagesById = new Map(this.data.messages.map(m => [m.id, m]));
    this.edgesByChild = new Map(this.data.edges.map(e => [e.childId, e]));
    this.unavailableMessages = new Set(this.data.unavailableMessageIds);
  }
  private id(prefix: string): string {
    this.data.counter++;
    return prefix + '-' + String(this.data.counter).padStart(5, '0');
  }
  private now(): string {
    const value = this.clock.now(this.data.tick);
    assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid conversation clock time');
    const time = new Date(value).toISOString();
    this.data.tick++;
    return time;
  }
  private adapter(id: string): ProviderAdapter {
    const adapter = this.adapters.get(id);
    assert(adapter, 'provider unavailable: ' + id);
    const p = adapter.snapshot;
    assert(p.availability === 'available' && p.chat.supported &&
      p.chat.authorized && p.chat.availability === 'available', 'provider chat unavailable: ' + id);
    return adapter;
  }
  private conversation(id: string): Conversation {
    const value = this.conversationsById.get(id);
    if (!value) throw new Error('conversation missing: ' + id);
    return value;
  }
  private message(id: string): Message {
    const value = this.messagesById.get(id);
    if (!value) throw new Error('message missing: ' + id);
    return value;
  }
  private once(key: string | undefined): string | undefined {
    return key ? this.data.idempotency[key] : undefined;
  }
  private remember(key: string | undefined, result: string): void {
    if (key) this.data.idempotency[key] = result;
  }
  createChat(kind: Kind, providerId: string, title: string, key?: string): Conversation {
    const previous = this.once(key);
    if (previous) return copy(this.conversation(previous));
    assert(kind === 'ordinary' || kind === 'codex', 'invalid kind');
    assert(title.trim().length > 0, 'title required');
    const adapter = this.adapter(providerId);
    const id = this.id('conv');
    const session = adapter.open({ conversationId: id, context: null });
    const c: Conversation = {
      id, kind, title, providerId, localSessionId: this.id('local'),
      providerSessionId: session.providerSessionId, createdAt: this.now(),
      state: 'idle', ownMessageIds: []
    };
    this.data.conversations.push(c);
    this.conversationsById.set(c.id, c);
    this.remember(key, id);
    return copy(c);
  }
  renameConversation(conversationId: string, title: string): Conversation {
    assert(typeof title === 'string' && title.trim().length > 0 && title.length <= 200, 'invalid conversation title');
    const conversation = this.conversation(conversationId);
    conversation.title = title.trim();
    return copy(conversation);
  }
  addMessage(conversationId: string, role: Role, content: string,
    options: { key?: string; provenance?: Provenance; referenceIds?: string[]; constraint?: boolean; sensitivity?: Sensitivity; providerTurnId?: string } = {}): Message {
    const previous = this.once(options.key);
    if (previous) return copy(this.message(previous));
    const c = this.conversation(conversationId);
    assert(['user', 'assistant', 'system'].includes(role), 'invalid role');
    assert(content.trim().length > 0, 'empty message');
    const msg: Message = {
      id: this.id('msg'), conversationId, sequence: c.ownMessageIds.length + 1,
      role, content, provenance: options.provenance ?? 'user', createdAt: this.now(),
      referenceIds: options.referenceIds ?? [], constraint: options.constraint ?? false,
      sensitivity: options.sensitivity ?? 'internal', providerTurnId: options.providerTurnId
    };
    this.data.messages.push(msg);
    this.messagesById.set(msg.id, msg);
    c.ownMessageIds.push(msg.id);
    this.remember(options.key, msg.id);
    return copy(msg);
  }
  addArtifact(conversationId: string, sourceMessageId: string, label: string, uri: string): Artifact {
    const source = this.message(sourceMessageId);
    assert(source.conversationId === conversationId, 'artifact source must belong to conversation');
    const a: Artifact = {
      id: this.id('artifact'), conversationId, sourceMessageId, label, uri,
      provenance: source.provenance, createdAt: this.now()
    };
    this.data.artifacts.push(a);
    return copy(a);
  }
  conversationHeader(id: string): Pick<Conversation, 'title' | 'providerId' | 'kind'> {
    const { title, providerId, kind } = this.conversation(id);
    return { title, providerId, kind };
  }
  messageHeader(id: string): { id: string; conversationId: string; createdAt: string; unavailable: boolean } | null {
    const message = this.messagesById.get(id);
    return message ? { id, conversationId: message.conversationId, createdAt: message.createdAt, unavailable: this.unavailableMessages.has(id) } : null;
  }
  ownsMessage(conversationId: string, messageId: string): boolean {
    const message = this.messagesById.get(messageId);
    return !!message && message.conversationId === conversationId && this.conversationsById.get(conversationId)?.ownMessageIds[message.sequence - 1] === messageId;
  }
  private visibleMessageRecords(conversationId:string,budget?:{remaining:number}):Message[] {
    const lineage: Conversation[] = [];
    for (let c = this.conversation(conversationId); ; ) {
      if (budget) {
        const count = 1 + c.ownMessageIds.length;
        if (count > budget.remaining) throw new MetadataScanLimit();
        budget.remaining -= count;
      }
      lineage.push(c);
      const edge = this.edgesByChild.get(c.id);
      if (!edge) break;
      c = this.conversation(edge.parentId);
    }

    // Reuse one array as each fork trims the parent view to its anchor.
    const records: Message[] = [];
    for (const c of lineage.reverse()) {
      const edge = this.edgesByChild.get(c.id);
      if (edge) {
        const index = records.findIndex(message => message.id === edge.sourceMessageId);
        assert(index >= 0, 'fork point absent');
        records.length = index + 1;
      }
      for (const id of c.ownMessageIds) records.push(this.message(id));
    }
    return records;
  }
  visibleMessages(conversationId: string): Message[] {return this.visibleMessageRecords(conversationId).map(copy);}
  pageVisibleMessages(
    conversationId: string,
    select: (ids: readonly string[]) => { offset: number; limit: number },
    allow: (conversationId: string, messageId: string) => boolean,
  ): { items: Message[]; total: number; offset: number; limit: number; hasMore: boolean } {
    const records = this.visibleMessageRecords(conversationId)
      .filter(message => !this.unavailableMessages.has(message.id) && allow(message.conversationId, message.id));
    const { offset, limit } = select(records.map(message => message.id));
    assert(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 200, 'invalid_page');
    return {
      items: records.slice(offset, offset + limit).map(copy),
      total: records.length,
      offset,
      limit,
      hasMore: offset + limit < records.length,
    };
  }
  searchVisibleMessages(
    conversationIds: readonly string[],
    needle: string,
    allow: (conversationId: string, messageId: string) => boolean,
  ): Map<string, MessageSearchMatch[]> {
    const results = new Map<string, MessageSearchMatch[]>();
    const examined = new Map<string, MessageSearchMatch | null>();
    for (const conversationId of conversationIds) {
      const matches: MessageSearchMatch[] = [];
      for (const message of this.visibleMessageRecords(conversationId)) {
        if (!examined.has(message.id)) {
          let match: MessageSearchMatch | null = null;
          if (!this.unavailableMessages.has(message.id) && allow(message.conversationId, message.id)) {
            const content = message.content;
            const index = content.toLocaleLowerCase().indexOf(needle);
            if (index >= 0) match = Object.freeze({
              id: message.id,
              createdAt: message.createdAt,
              get excerpt() { return content.slice(Math.max(0, index - 60), index + 160); },
            });
          }
          examined.set(message.id, match);
        }
        const match = examined.get(message.id);
        if (match) matches.push(match);
      }
      if (matches.length) results.set(conversationId, matches);
    }
    return results;
  }
  /** Bounded lineage projection only. Counts/bytes describe this window, never the entire history.
   * maxScan counts ancestry nodes plus own-message refs before allocation.
   * The mandatory host policy gates ALL contributing messages before anything escapes. */
  visibleMessageMetadata(conversationId:string,options:{limit:number;maxScan:number;maxBodyBytes:number;offset?:number;tail?:boolean;allow(meta:Readonly<Pick<MessageMetadata,'id'|'conversationId'|'sequence'|'role'|'sensitivity'|'unavailable'>>):boolean}):MessageMetadataWindow {
    const {limit,maxScan,maxBodyBytes}=options,offset=options.offset??0;
    assert([limit,maxScan,maxBodyBytes,offset].every(value=>Number.isSafeInteger(value)&&value>=0)&&limit<=256&&maxScan<=4096&&maxBodyBytes<=131072&&offset<=4096&&(options.tail===undefined||typeof options.tail==='boolean')&&typeof options.allow==='function','invalid metadata limits');
    const empty=(limitedBy:MessageMetadataWindow['limitedBy']):MessageMetadataWindow=>({items:[],emittedCount:0,emittedBodyBytes:0,hasMore:false,limitedBy});
    let records:Message[];try{records=this.visibleMessageRecords(conversationId,{remaining:maxScan});}catch(error){if(error instanceof MetadataScanLimit)return empty('scan-limit');throw error;}
    for(const message of records){const meta=Object.freeze({id:message.id,conversationId:message.conversationId,sequence:message.sequence,role:message.role,sensitivity:message.sensitivity,unavailable:this.unavailableMessages.has(message.id)});try{if(options.allow(meta)!==true)return empty('denied');}catch{return empty('denied');}}
    const end=options.tail?Math.max(0,records.length-offset):Math.min(records.length,offset+limit),start=options.tail?Math.max(0,end-limit):Math.min(offset,records.length);
    const indices=Array.from({length:Math.max(0,end-start)},(_,index)=>start+index);if(options.tail)indices.reverse();
    const items:MessageMetadata[]=[];let emittedBodyBytes=0,limitedBy:MessageMetadataWindow['limitedBy']=null;
    for(const index of indices){const message=records[index],remaining=maxBodyBytes-emittedBodyBytes;if(message.content.length>remaining){limitedBy='byte-limit';break;}
      const bodyBytes=Buffer.byteLength(message.content,'utf8');if(bodyBytes>remaining){limitedBy='byte-limit';break;}
      items.push({id:message.id,conversationId:message.conversationId,sequence:message.sequence,role:message.role,sensitivity:message.sensitivity,ordinal:index+1,bodyBytes,unavailable:this.unavailableMessages.has(message.id)});emittedBodyBytes+=bodyBytes;
    }
    if(options.tail)items.reverse();return {items,emittedCount:items.length,emittedBodyBytes,hasMore:start>0||end<records.length||limitedBy!==null,limitedBy};
  }
  branch(input: {
    sourceConversationId: string; sourceMessageId: string; targetKind: Kind;
    targetProviderId: string; title: string; includeMessageIds?: string[];
    artifactIds?: string[]; allowSensitive?: boolean; key?: string;
  }): { conversation: Conversation; edge: LineageEdge; handoff: ContextPackage } {
    const previous = this.once(input.key);
    if (previous) {
      const c = this.conversation(previous);
      return { conversation: copy(c), edge: copy(this.data.edges.find(e => e.childId === c.id)!),
        handoff: copy(this.data.handoffs.find(h => h.targetConversationId === c.id)!) };
    }
    const source = this.conversation(input.sourceConversationId);
    const visible = this.visibleMessages(source.id);
    const end = visible.findIndex(m => m.id === input.sourceMessageId);
    assert(end >= 0, 'fork source message is not visible');
    assert(!this.data.unavailableMessageIds.includes(input.sourceMessageId), 'fork source unavailable');
    const eligible = visible.slice(0, end + 1);
    const selectedIds = input.includeMessageIds ?? [input.sourceMessageId];
    assert(selectedIds.length > 0 && new Set(selectedIds).size === selectedIds.length, 'invalid inclusion');
    for (const id of selectedIds) assert(eligible.some(m => m.id === id), 'included message outside fork boundary: ' + id);
    const selected = eligible.filter(m => selectedIds.includes(m.id)).map(m => {
      assert(!this.data.unavailableMessageIds.includes(m.id), 'included source unavailable: ' + m.id);
      assert(m.sensitivity !== 'restricted', 'restricted source cannot enter handoff: ' + m.id);
      assert(m.sensitivity !== 'sensitive' || input.allowSensitive === true, 'sensitive source requires explicit inclusion consent: ' + m.id);
      return m;
    });
    const adapter = this.adapter(input.targetProviderId);
    const native = source.providerId === input.targetProviderId &&
      adapter.snapshot.nativeFork.supported && adapter.snapshot.nativeFork.authorized &&
      adapter.snapshot.nativeFork.availability === 'available' && !!adapter.fork &&
      !!source.providerSessionId && !!visible[end].providerTurnId &&
      visible[end].conversationId === source.id &&
      selected.length === eligible.length;
    const mode = native ? 'native_fork' : 'application_continuation';
    const targetId = this.id('conv');
    const handoff: ContextPackage = {
      id: this.id('handoff'), targetConversationId: targetId,
      sourceConversationId: source.id, forkMessageId: input.sourceMessageId,
      createdAt: this.now(), mode,
      items: selected.map(m => ({
        sourceConversationId: m.conversationId, sourceMessageId: m.id,
        sourceTime: m.createdAt, content: m.content, digest: digest(m.content),
        role: m.role, provenance: m.provenance, referenceIds: [...m.referenceIds],
        constraint: m.constraint, sensitivity: m.sensitivity
      })),
      artifactIds: input.artifactIds ?? [],
      excludedMessageIds: eligible.filter(m => !selectedIds.includes(m.id)).map(m => m.id),
      state: 'ready'
    };
    for (const artifactId of handoff.artifactIds) {
      const a = this.data.artifacts.find(item => item.id === artifactId);
      assert(a && eligible.some(m => m.id === a.sourceMessageId), 'artifact outside fork boundary');
    }
    let providerSessionId: string | null = null;
    try {
      const request = { conversationId: targetId, parentProviderSessionId: source.providerSessionId,
        parentProviderTurnId: visible[end].providerTurnId, context: copy(handoff) };
      providerSessionId = native ? adapter.fork!(request).providerSessionId : adapter.open(request).providerSessionId;
      handoff.suppliedAt = this.now();
    } catch (error) {
      handoff.state = 'failed';
      handoff.error = error instanceof Error ? error.message : String(error);
    }
    const c: Conversation = {
      id: targetId, kind: input.targetKind, title: input.title,
      providerId: input.targetProviderId, localSessionId: this.id('local'),
      providerSessionId, createdAt: this.now(),
      state: handoff.state === 'ready' ? 'idle' : 'failed', ownMessageIds: []
    };
    const edge: LineageEdge = {
      id: this.id('edge'), parentId: source.id, childId: c.id,
      sourceMessageId: input.sourceMessageId, mode, handoffId: handoff.id, createdAt: this.now()
    };
    this.data.conversations.push(c);
    this.conversationsById.set(c.id, c);
    this.data.handoffs.push(handoff);
    this.data.edges.push(edge);
    this.edgesByChild.set(c.id, edge);
    this.remember(input.key, c.id);
    return { conversation: copy(c), edge: copy(edge), handoff: copy(handoff) };
  }
  runMock(conversationId: string, prompt: string, key?: string): Message {
    const previous = this.once(key);
    if (previous) return copy(this.message(previous));
    const c = this.conversation(conversationId);
    const adapter = this.adapter(c.providerId);
    assert(adapter.snapshot.mock && adapter.respond, 'demo response requires a labeled mock adapter');
    this.addMessage(conversationId, 'user', prompt, { provenance: 'user' });
    const response = adapter.respond(c, prompt);
    const providerTurnId = c.providerId === 'mock-codex' ? 'mock-turn:' + c.id + ':' + c.ownMessageIds.length : undefined;
    return this.addMessage(conversationId, 'assistant', response,
      { provenance: 'mock_adapter', providerTurnId, key });
  }
  markUnavailable(messageId: string): void {
    this.message(messageId);
    if (this.unavailableMessages.has(messageId)) return;
    this.data.unavailableMessageIds.push(messageId);
    this.unavailableMessages.add(messageId);
  }
  interruptHandoff(handoffId: string): void {
    const h = this.data.handoffs.find(item => item.id === handoffId);
    assert(h, 'handoff missing');
    h.state = 'interrupted';
    this.conversation(h.targetConversationId).state = 'interrupted';
  }
  inspectHandoff(handoffId: string): ContextPackage & { staleMessageIds: string[] } {
    const h = this.data.handoffs.find(item => item.id === handoffId);
    assert(h, 'handoff missing');
    const staleMessageIds = h.items.filter(item => {
      const source = this.data.messages.find(m => m.id === item.sourceMessageId);
      return !source || this.data.unavailableMessageIds.includes(item.sourceMessageId) ||
        digest(source.content) !== item.digest;
    }).map(item => item.sourceMessageId);
    return { ...copy(h), staleMessageIds };
  }
  snapshot(): GraphData { return copy(this.data); }
  exportJson(): string { this.validate(); return JSON.stringify(this.data, null, 2); }
  static importJson(json: string, adapters: ProviderAdapter[], options: ConversationGraphOptions = {}): ConversationGraph {
    return new ConversationGraph(adapters, JSON.parse(json) as GraphData, options);
  }
  validate(): void {
    const d = this.data;
    assert(d.schemaVersion === SCHEMA_VERSION, 'unsupported schema version');
    assert(Number.isInteger(d.counter) && Number.isInteger(d.tick), 'invalid counters');
    for (const name of ['providers', 'conversations', 'messages', 'artifacts', 'edges', 'handoffs', 'unavailableMessageIds'] as const)
      assert(Array.isArray(d[name]), 'invalid ' + name);
    assert(d.idempotency && typeof d.idempotency === 'object', 'invalid idempotency map');
    const all = [...d.conversations, ...d.messages, ...d.artifacts, ...d.edges, ...d.handoffs];
    assert(new Set(all.map(x => x.id)).size === all.length, 'duplicate identity');
    const conversations = new Map(d.conversations.map(c => [c.id, c]));
    const messages = new Map(d.messages.map(m => [m.id, m]));
    for (const c of d.conversations) {
      assert(typeof c.title === 'string' && typeof c.localSessionId === 'string', 'invalid conversation');
      assert(c.ownMessageIds.every((id, i) => {
        const m = messages.get(id);
        return m?.conversationId === c.id && m.sequence === i + 1;
      }), 'invalid message sequence');
    }
    for (const m of d.messages)
      assert(conversations.has(m.conversationId) && typeof m.content === 'string', 'invalid message');
    for (const e of d.edges)
      assert(conversations.has(e.parentId) && conversations.has(e.childId) &&
        messages.has(e.sourceMessageId) && d.handoffs.some(h => h.id === e.handoffId), 'invalid edge');
    assert(new Set(d.edges.map(e => e.childId)).size === d.edges.length, 'multiple parents');
    for (const c of d.conversations) {
      let cursor = c.id;
      const seen = new Set<string>();
      while (true) {
        assert(!seen.has(cursor), 'lineage cycle');
        seen.add(cursor);
        const edge = d.edges.find(e => e.childId === cursor);
        if (!edge) break;
        cursor = edge.parentId;
      }
    }
    for (const h of d.handoffs) {
      assert(conversations.has(h.targetConversationId) && conversations.has(h.sourceConversationId), 'invalid handoff');
      for (const item of h.items)
        assert(messages.has(item.sourceMessageId) && digest(item.content) === item.digest &&
          messages.get(item.sourceMessageId)?.content === item.content &&
          messages.get(item.sourceMessageId)?.sensitivity === item.sensitivity, 'invalid context item');
    }
    for (const id of d.unavailableMessageIds) assert(messages.has(id), 'invalid unavailable message');
    for (const id of Object.values(d.idempotency))
      assert(all.some(item => item.id === id), 'invalid idempotency result');
  }
}
