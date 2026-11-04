import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { prepareResponsesTurn, ResponsesTransport } from '../../openai-provider/responses.mts';
import type { ApiContinuation, ApiJsonSchema, ApiResponseItem, ApiToolOutput, DispatchReview, ReviewedApiFunction, TurnEvent, TurnResult } from '../../openai-provider/contracts.mts';
import { VELA_API_PROVIDER } from '../../openai-provider/api-connection-contracts.mts';
import { VELA_IDENTITY_VERSION, renderVelaIdentityPrompt } from '../../vela-core/src/vela-identity.mts';
import { capabilitySchemaTool, CAPABILITY_SCHEMA_TOOL, type CapabilityCatalogSnapshot } from '../../vela-core/src/capability-catalog.mts';
import { VelaError } from '../../vela-core/src/capabilities.ts';
import { VELA_API_CONFIGURATION_ID, type VelaApiConnection } from './vela-api-connection.mts';
import type { ReasoningEffort } from '../../openai-provider/model-controls.ts';

// Native code-reviewed controls, independent of catalog presence/entitlement.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
export function velaApiReasoningEfforts(model: string): readonly ReasoningEffort[] {
  return model === 'gpt-6-luna' ? ['none','low','medium','high','xhigh','max'] : model === 'gpt-6.1-sol' ? ['low','medium','high','xhigh','max'] : [];
}

export const VELA_API_RUNTIME_LIMITS = Object.freeze({ maxOutputTokens: 2048, requestsPerDay: 64, stages: 4, discoveryCalls: 3, toolBytes: 16384 });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const check: (value: unknown, code: string) => asserts value = (value, code) => { if (!value) throw new VelaError(code); };
export interface VelaApiUsageStatus { enabled: boolean; configurationVersion: number | null; maxOutputTokens: number; requestsPerDay: number; usedToday: number }
export interface VelaApiRuntimeTestServices { fetch: typeof fetch; voice?: {fetch:typeof fetch;acknowledgementMs?:number} }
export interface VelaApiRuntimeOptions {
  db: DatabaseSync; transaction<T>(work: () => T): T; connection: VelaApiConnection;
  /** Native synthetic-only constructor injection, never a serialized option. */
  test?: VelaApiRuntimeTestServices;
  observe?: {
    stage(executionId: string, requestId: string, review: DispatchReview): void;
    event(event: TurnEvent, requestId: string): void;
    completed(executionId: string, requestId: string, result: TurnResult, elapsedMs: number): void;
  };
}
export interface VelaApiRun {
  requestId: string; version: number; model: string; prompt: string; instruction?: string; contextDigest: string;
  reasoningEffort?: ReasoningEffort;
  catalog?: CapabilityCatalogSnapshot; outputSchema?: ApiJsonSchema;
  validate(): void;
  stage?(executionId: string, review: DispatchReview): void;
  event?(event: TurnEvent): void;
  completed?(executionId: string, result: TurnResult): void;
}
/** Metadata and receipts only. Canonical VelaService owns every conversation body. */
export class VelaApiRuntime {
  private readonly options: VelaApiRuntimeOptions;
  private readonly lifetime = new AbortController();
  private running = false;
  private knownCatalog?: { version: number; expiresAt: number; models: string[] };
  constructor(options: VelaApiRuntimeOptions) { this.options = options; }
  static migrate(db: DatabaseSync) {
    check(db.isTransaction, 'api_storage_unavailable');
    db.exec(`CREATE TABLE IF NOT EXISTS vela_api_usage(id INTEGER PRIMARY KEY CHECK(id=1),configuration_version INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vela_api_runs(execution_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,configuration_version INTEGER NOT NULL,utc_day TEXT NOT NULL,body_digest TEXT NOT NULL,context_digest TEXT NOT NULL,state TEXT NOT NULL,result_digest TEXT,response_id TEXT,usage_json TEXT,elapsed_ms INTEGER);
      CREATE INDEX IF NOT EXISTS vela_api_runs_day ON vela_api_runs(utc_day);
      CREATE TABLE IF NOT EXISTS vela_api_tool_receipts(receipt_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,call_id TEXT NOT NULL,arguments_digest TEXT NOT NULL,output_digest TEXT NOT NULL,UNIQUE(execution_id,call_id));`);
    // An interrupted transport has no confirmed outcome. No automatic replay.
    db.prepare("UPDATE vela_api_runs SET state='unknown' WHERE state='dispatching'").run();
  }
  configurationVersion(): number | null {
    const row = this.options.db.prepare('SELECT version,enabled FROM openai_api_configuration WHERE configuration_id=?').get(VELA_API_CONFIGURATION_ID);
    return row?.enabled === 1 && Number.isSafeInteger(row.version) ? Number(row.version) : null;
  }
  usageStatus(): VelaApiUsageStatus {
    const version = this.configurationVersion(), row = this.options.db.prepare('SELECT configuration_version,enabled FROM vela_api_usage WHERE id=1').get();
    return { enabled: version !== null && row?.configuration_version === version && row.enabled === 1,
      configurationVersion: version, maxOutputTokens: VELA_API_RUNTIME_LIMITS.maxOutputTokens,
      requestsPerDay: VELA_API_RUNTIME_LIMITS.requestsPerDay,
      usedToday: Number(this.options.db.prepare('SELECT count(*) AS n FROM vela_api_runs WHERE utc_day=?').get(new Date().toISOString().slice(0,10))!.n) };
  }
  authorizeUsage(expectedVersion: number, enabled: boolean): VelaApiUsageStatus {
    check(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1 && typeof enabled === 'boolean', 'api_configuration_invalid');
    this.options.transaction(() => {
      check(this.configurationVersion() === expectedVersion, 'api_configuration_changed');
      this.options.db.prepare('INSERT INTO vela_api_usage VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET configuration_version=excluded.configuration_version,enabled=excluded.enabled,observed_at=excluded.observed_at')
        .run(expectedVersion, Number(enabled), new Date().toISOString());
    });
    return this.usageStatus();
  }
  authorized(version = this.configurationVersion()): boolean {
    return !this.lifetime.signal.aborted && version !== null && this.usageStatus().enabled && this.configurationVersion() === version;
  }
  availability() { const available = this.authorized(); return { available, busy: this.running,
    ...(!available ? { reason: 'Dedicated Vela API usage has not been authorized for this configuration.' } : {}) }; }
  private validate(version: number) { check(this.authorized(version), 'vela_api_usage_authorization_required'); }
  async models(version: number): Promise<string[]> {
    this.validate(version);
    try { const catalog = await this.options.connection.resolveCatalog(version); this.knownCatalog = { version, expiresAt: catalog.expiresAt, models: [...catalog.models] }; return [...catalog.models]; }
    catch (error) { if ((error as { code?: string }).code !== 'api_catalog_stale') throw error; }
    await this.options.connection.catalog(version);
    this.validate(version);
    const catalog = await this.options.connection.resolveCatalog(version); this.knownCatalog = { version, expiresAt: catalog.expiresAt, models: [...catalog.models] }; return [...catalog.models];
  }
  knownModels() { return this.knownCatalog && this.authorized(this.knownCatalog.version) && this.knownCatalog.expiresAt > Date.now() ? [...this.knownCatalog.models] : []; }
  matchesResult(executionId: string, content: string): boolean {
    const row = this.options.db.prepare('SELECT state,result_digest FROM vela_api_runs WHERE execution_id=?').get(executionId);
    return row?.state === 'completed' && row.result_digest === digest(content);
  }
  bindCanonicalResult(executionId: string, raw: string, canonical: string) {
    this.options.transaction(() => {
      check(this.matchesResult(executionId,raw), 'planning_output_provenance_mismatch');
      this.options.db.prepare('UPDATE vela_api_runs SET result_digest=? WHERE execution_id=?').run(digest(canonical),executionId);
    });
  }
  receiptsForRequest(requestId: string) {
    return this.options.db.prepare('SELECT execution_id AS executionId,body_digest AS bodyDigest,context_digest AS contextDigest,state,response_id AS responseId,elapsed_ms AS elapsedMs FROM vela_api_runs WHERE request_id=? ORDER BY rowid LIMIT 4').all(requestId);
  }
  async run(input: VelaApiRun, signal: AbortSignal) {
    check(!this.running && !this.lifetime.signal.aborted, 'vela_api_busy');
    this.validate(input.version); input.validate();
    const reasoningEfforts = velaApiReasoningEfforts(input.model);
    check(input.reasoningEffort === undefined || reasoningEfforts.includes(input.reasoningEffort), 'unsupported_reasoning_effort');
    this.running = true;
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(90000)]);
    const receipts = new Map<string, ApiToolOutput>(), items: ApiResponseItem[] = [], fetched = new Set<string>();
    let continuation: ApiContinuation | undefined, calls = 0, final: { executionId: string; result: TurnResult; fetchedIds: string[] } | undefined;
    const definitions: ReviewedApiFunction[] = [];
    if (input.catalog) {
      const tool = capabilitySchemaTool(input.catalog.projection);
      const nativeParameters = structuredClone(tool.inputSchema);
      const { uniqueItems: _nativeUniqueness, ...ids } = nativeParameters.properties.ids;
      const parameters = { ...nativeParameters, properties: { ...nativeParameters.properties, ids: { ...ids, items: { type: 'string', ...ids.items } } } };
      const definition = { type: 'function' as const, name: tool.name, description: tool.description, parameters: parameters as unknown as ApiJsonSchema, strict: true as const };
      definitions.push({ definition, schemaDigest: digest(JSON.stringify(definition)), authorizationRef: 'vela-api-schema:' + input.catalog.projection.digest });
    }
    const fence = () => { check(!combined.aborted, 'vela_execution_cancelled'); this.validate(input.version); input.validate(); };
    try {
      for (let stage = 0; stage < VELA_API_RUNTIME_LIMITS.stages; stage++) {
        fence();
        const executionId = randomUUID(), started = performance.now();
        const turn = { executionId, requestId: input.requestId, configurationId: VELA_API_CONFIGURATION_ID, providerId: VELA_API_PROVIDER,
          assistant: 'vela' as const, model: input.model,
          instructions: renderVelaIdentityPrompt('assistant') + '\n' + (input.instruction ?? 'Answer naturally and concisely using the supplied context. Never claim an action occurred without an observed host receipt.'),
          messages: [{ role: 'user' as const, content: input.prompt }], contextDigest: input.contextDigest,
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          api: { configurationVersion: input.version, instructionVersion: VELA_IDENTITY_VERSION,
            maxOutputTokens: VELA_API_RUNTIME_LIMITS.maxOutputTokens, ...(definitions.length ? { tools: definitions } : {}),
            ...(input.reasoningEffort ? { reasoningEfforts } : {}),
            ...(input.outputSchema ? { outputFormat: { type: 'json_schema' as const, name: 'vela_scoped_proposal', schema: input.outputSchema, strict: true as const } } : {}),
            ...(continuation ? { continuation } : {}) } };
        const expected = prepareResponsesTurn(turn).review;
        let admitted = false;
        const exactReview = (review: DispatchReview) => {
          check(JSON.stringify(review) === JSON.stringify(expected), 'approval_scope_mismatch'); fence();
          for (const output of review.api?.continuation?.toolOutputs ?? []) {
            const receipt = this.options.db.prepare('SELECT arguments_digest,output_digest FROM vela_api_tool_receipts WHERE receipt_id=? AND execution_id=? AND call_id=?')
              .get(output.receiptId, continuation!.sourceExecutionId, output.callId);
            // Older outputs in a bounded continuation retain their exact native receipt identity.
            const known = receipts.get(output.callId);
            check(known && known.receiptId === output.receiptId && known.argumentsDigest === output.argumentsDigest && digest(known.output) === output.outputDigest,
              'api_tool_receipt_mismatch');
            check(receipt || this.options.db.prepare('SELECT 1 FROM vela_api_tool_receipts WHERE receipt_id=? AND arguments_digest=? AND output_digest=?').get(output.receiptId, output.argumentsDigest, output.outputDigest), 'api_tool_receipt_mismatch');
          }
        };
        const transport = new ResponsesTransport({ ...(this.options.test ? { fetch: this.options.test.fetch } : {}), limits: { outputBytes: 65536, timeoutMs: 45000 },
          onEvent: event => { fence(); if (input.event) input.event(event); else this.options.observe?.event(event,input.requestId); }, native: {
            authorize: async review => {
              exactReview(review); check(!admitted, 'api_execution_already_dispatched');
              this.options.transaction(() => {
                fence(); check(this.usageStatus().usedToday < VELA_API_RUNTIME_LIMITS.requestsPerDay, 'vela_api_daily_limit_reached');
                this.options.db.prepare('INSERT INTO vela_api_runs(execution_id,request_id,configuration_version,utc_day,body_digest,context_digest,state) VALUES(?,?,?,?,?,?,?)')
                  .run(executionId,input.requestId,input.version,new Date().toISOString().slice(0,10),review.bodyDigest,input.contextDigest,'dispatching');
                if (input.stage) input.stage(executionId,review); else this.options.observe?.stage(executionId,input.requestId,review);
                admitted = true;
              });
            },
            resolveCredential: async (configurationId, providerId) => {
              fence(); check(configurationId === VELA_API_CONFIGURATION_ID && providerId === VELA_API_PROVIDER, 'credential_boundary_mismatch');
              return this.options.connection.resolveNativeCredential(input.version);
            },
            resolveCatalog: async () => { fence(); return this.options.connection.resolveCatalog(input.version); },
            revalidate: async (review, boundaryDigest) => { exactReview(review); await this.options.connection.revalidate(input.version,boundaryDigest); fence(); },
          } });
        const result = await transport.turn(turn, combined);
        if (admitted) this.options.transaction(() => {
          this.options.db.prepare('UPDATE vela_api_runs SET state=?,result_digest=?,response_id=?,usage_json=?,elapsed_ms=? WHERE execution_id=?')
            .run(result.outcome,result.outcome === 'completed' ? digest(result.partialText) : null,result.responseId ?? null,result.usage ? JSON.stringify(result.usage) : null,Math.round(performance.now()-started),executionId);
          if (input.completed) input.completed(executionId,result);
          else this.options.observe?.completed(executionId,input.requestId,result,Math.round(performance.now()-started));
        });
        final = { executionId, result, fetchedIds: [...fetched] };
        if (result.outcome !== 'completed') return final;
        fence();
        if (!result.api?.toolCalls.length) return final;
        fence(); check(input.catalog && result.responseId, 'unreviewed_api_function');
        for (const call of result.api.toolCalls) {
          check(++calls <= VELA_API_RUNTIME_LIMITS.discoveryCalls && call.name === CAPABILITY_SCHEMA_TOOL && call.executionId === executionId &&
            call.configurationVersion === input.version && call.contextDigest === input.contextDigest && !receipts.has(call.callId), 'api_tool_call_limit');
          const query = JSON.parse(call.arguments);
          check(query && typeof query === 'object' && !Array.isArray(query) && Object.keys(query).length === 2 &&
            query.catalogDigest === input.catalog.projection.digest && Array.isArray(query.ids) && query.ids.length >= 1 && query.ids.length <= 4 &&
            new Set(query.ids).size === query.ids.length && query.ids.every((id: unknown) => typeof id === 'string' && input.catalog!.descriptors.some(item => item.id === id)), 'invalid_capability_schema_query');
          fence();
          const output = JSON.stringify({ catalogDigest: input.catalog.projection.digest, descriptors: input.catalog.descriptors.filter(item => query.ids.includes(item.id)) });
          check(Buffer.byteLength(output) <= VELA_API_RUNTIME_LIMITS.toolBytes, 'capability_discovery_response_budget_exceeded');
          const receiptId = randomUUID(), receipt = { callId: call.callId, name: call.name, argumentsDigest: call.argumentsDigest, output, receiptId };
          this.options.transaction(() => { fence(); this.options.db.prepare('INSERT INTO vela_api_tool_receipts VALUES(?,?,?,?,?)').run(receiptId,executionId,call.callId,call.argumentsDigest,digest(output)); });
          receipts.set(call.callId, receipt); query.ids.forEach((id: string) => fetched.add(id));
        }
        items.push(...result.api.outputItems);
        continuation = { sourceExecutionId: executionId, responseId: result.responseId, configurationVersion: input.version,
          contextDigest: input.contextDigest, sourceOutcome: 'completed', itemsDigest: digest(JSON.stringify(items)), items: structuredClone(items), toolOutputs: [...receipts.values()] };
      }
      throw new VelaError('api_tool_call_limit');
    } finally { this.running = false; }
  }
  async structuredProposal(input: { instruction: string; payload: unknown; schema: ApiJsonSchema; requestId: string; model?:string;reasoningEffort?:ReasoningEffort;onResult?(result:TurnResult):void;validate(): void }, signal: AbortSignal): Promise<unknown> {
    const version = this.configurationVersion(); check(version !== null, 'api_configuration_disconnected');
    const model=input.model??'gpt-6-luna',models = await this.models(version); check(models.includes(model), 'vela_api_default_model_unavailable');
    const prompt = JSON.stringify(input.payload); check(Buffer.byteLength(prompt) <= 32768, 'context_budget_exceeded');
    const { result } = await this.run({ requestId: input.requestId, version, model, prompt,
      instruction: input.instruction, reasoningEffort:input.reasoningEffort??'low', contextDigest: digest(prompt), outputSchema: input.schema, validate: input.validate }, signal);
    input.onResult?.(result);
    check(result.outcome === 'completed', result.errorCode ?? 'vela_api_proposal_failed');
    try{return JSON.parse(result.partialText);}catch{throw new VelaError('vela_api_proposal_invalid');}
  }
  close() { this.lifetime.abort(); }
}
