import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { prepareResponsesTurn, ResponsesTransport } from '../../openai-provider/responses.mts';
import type { ApiContinuation, ApiContextTransition, ApiFunctionCall, ApiJsonSchema, ApiResponseItem, ApiToolOutput, DispatchReview, ReviewedApiFunction, TurnEvent, TurnResult } from '../../openai-provider/contracts.mts';
import { VELA_API_PROVIDER } from '../../openai-provider/api-connection-contracts.mts';
import { VELA_IDENTITY_VERSION, renderVelaIdentityPrompt } from '../../vela-core/src/vela-identity.mts';
import { capabilitySchemaTool, CAPABILITY_SCHEMA_TOOL, type CapabilityCatalogSnapshot } from '../../vela-core/src/capability-catalog.mts';
import { VelaError } from '../../vela-core/src/capabilities.ts';
import { VELA_API_CONFIGURATION_ID, type VelaApiConnection } from './vela-api-connection.mts';
import type { ReasoningEffort } from '../../openai-provider/model-controls.ts';
import {apiRunDiagnostics,type ApiRunDiagnostics} from './api-run-diagnostics.mts';
import {abortable} from '../../openai-provider/common.mts';
import {WEATHER_TOOL,WEATHER_TOOL_NAME,validWeatherQuery,type WeatherQuery} from './weather-tool.mts';
import {validateWeatherData,type WeatherData} from './weather-data.mts';
import type {VelaToolInvocation,VelaToolPort,VelaToolReceipt,VelaWorkflowPhase} from '../../application-contract/vela-tools.ts';
import {VELA_TOOL_LIMITS,VELA_TOOL_DISCOVER,VELA_TOOL_SCHEMAS,VELA_TOOL_INVOKE,validateVelaToolCatalog,velaToolCatalogDigest,velaToolCatalogEnvelope,velaToolDefinitions,velaToolDiscovery,velaToolInvocation,validateVelaToolReceipt,parseVelaToolJson,velaToolsMayRunTogether} from './vela-semantic-tools.mts';

// Native code-reviewed controls, independent of catalog presence/entitlement.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
export function velaApiReasoningEfforts(model: string): readonly ReasoningEffort[] {
  return model === 'gpt-6-luna' ? ['none','low','medium','high','xhigh','max'] : model === 'gpt-6.1-sol' ? ['low','medium','high','xhigh','max'] : [];
}

export const VELA_API_RUNTIME_LIMITS = Object.freeze({ concurrent: 2, maxOutputTokens: 2048, requestsPerDay: 64, stages: 4, discoveryCalls: 3, toolBytes: 16384 });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const check: (value: unknown, code: string) => asserts value = (value, code) => { if (!value) throw new VelaError(code); };
export interface VelaApiUsageStatus { enabled: boolean; configurationVersion: number | null; maxOutputTokens: number; requestsPerDay: number; usedToday: number }
export interface VelaApiRunReceipt extends ApiRunDiagnostics {executionId:string;bodyDigest:string;contextDigest:string;state:TurnResult['outcome']|'dispatching';responseId:string|null;elapsedMs:number|null}
export interface VelaApiWeatherTool {run(input:WeatherQuery,signal:AbortSignal):Promise<WeatherData>}
export interface VelaApiRuntimeTestServices { fetch: typeof fetch; voice?: {fetch:typeof fetch;acknowledgementMs?:number};wake?:import('./vela-wake-runtime.mts').VelaWakeTestServices }
export interface VelaApiRuntimeOptions {
  db: DatabaseSync; transaction<T>(work: () => T): T; connection: VelaApiConnection;
  /** Shares the outer commit with canonical execution callbacks when present. */
  executionTransaction?<T>(work: () => T): T;
  /** Native synthetic-only constructor injection, never a serialized option. */
  test?: VelaApiRuntimeTestServices;
  observe?: {
    stage(executionId: string, requestId: string, review: DispatchReview): void | (() => void);
    event(event: TurnEvent, requestId: string): void;
    completed(executionId: string, requestId: string, result: TurnResult, elapsedMs: number): void;
  };
}
export interface VelaApiRun {
  requestId: string; version: number; model: string; prompt: string; instruction?: string; contextDigest: string;
  reasoningEffort?: ReasoningEffort;
  catalog?: CapabilityCatalogSnapshot; outputSchema?: ApiJsonSchema;
  /** Native, code-reviewed port only. Never enabled for mission workers. */
  weatherTool?:VelaApiWeatherTool;
  tools?:VelaToolPort;
  resume?:VelaApiToolContinuationRef;
  resumeReceipt?:VelaToolReceipt;
  resumeContext?:ApiContextTransition;
  /** Native certificate validator; never supplied by provider/model/renderer data. */
  validateResumeContext?(certificate:ApiContextTransition,binding:{contextDigest:string;promptDigest:string}):void;
  advanceContext?(receipts:readonly VelaToolReceipt[]):VelaApiContextAdvance|undefined|Promise<VelaApiContextAdvance|undefined>;
  /** Shares the canonical admission pool; never creates a second runtime or conversation. */
  lane?: 'mission-specialist';
  oneUse?: true;
  validate(): void;
  stage?(executionId: string, review: DispatchReview): void | (() => void);
  event?(event: TurnEvent): void;
  completed?(executionId: string, result: TurnResult): void;
}
export interface VelaApiToolContinuationRef {id:string;digest:string}
export interface VelaApiContextAdvance {prompt:string;contextDigest:string;resumeContext:ApiContextTransition}
export interface VelaApiRunResult {executionId:string;result:TurnResult;fetchedIds:string[];workflow?:{workflowId:string;phase:VelaWorkflowPhase;reason?:string;continuation?:VelaApiToolContinuationRef;pendingReceiptIds?:string[]}}
export interface VelaApiToolContinuation {
  contract:'aerynth.vela.tool-continuation@1';workflowId:string;requestId:string;version:number;contextDigest:string;selectionDigest:string;controlDigest?:string;catalogDigest:string;deadline:number;
  providerRequests:number;toolCalls:number;maxProviderRequests:number;maxToolCalls:number;budgetDeadline:string;fetchedSchemas:[string,string][];invokedIds:string[];outputBytes:number;
  items:ApiResponseItem[];receipts:ApiToolOutput[];fetchedIds:string[];continuation:ApiContinuation;final:VelaApiRunResult;
  pending:{call:ApiFunctionCall;invocation:VelaToolInvocation;receipt:VelaToolReceipt}[];
}
/** Metadata and receipts only. Canonical VelaService owns every conversation body. */
export class VelaApiRuntime {
  private readonly options: VelaApiRuntimeOptions;
  private readonly lifetime = new AbortController();
  private readonly running = new Map<string, VelaApiRun['lane']>();
  private knownCatalog?: { version: number; expiresAt: number; models: string[] };
  private catalogFlight?: { version: number; promise: Promise<string[]> };
  constructor(options: VelaApiRuntimeOptions) { this.options = options; }
  static migrate(db: DatabaseSync) {
    check(db.isTransaction, 'api_storage_unavailable');
    db.exec(`CREATE TABLE IF NOT EXISTS vela_api_usage(id INTEGER PRIMARY KEY CHECK(id=1),configuration_version INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vela_api_runs(execution_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,configuration_version INTEGER NOT NULL,utc_day TEXT NOT NULL,body_digest TEXT NOT NULL,context_digest TEXT NOT NULL,state TEXT NOT NULL,result_digest TEXT,response_id TEXT,usage_json TEXT,elapsed_ms INTEGER,error_code TEXT,http_diagnostic_json TEXT);
      CREATE INDEX IF NOT EXISTS vela_api_runs_day ON vela_api_runs(utc_day);
      CREATE TABLE IF NOT EXISTS vela_api_tool_receipts(receipt_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,call_id TEXT NOT NULL,arguments_digest TEXT NOT NULL,output_digest TEXT NOT NULL,UNIQUE(execution_id,call_id));`);
    const columns=new Set(db.prepare('PRAGMA table_info(vela_api_runs)').all().map(row=>row.name));
    if(!columns.has('error_code'))db.exec('ALTER TABLE vela_api_runs ADD COLUMN error_code TEXT');
    if(!columns.has('http_diagnostic_json'))db.exec('ALTER TABLE vela_api_runs ADD COLUMN http_diagnostic_json TEXT');
    const toolColumns=new Set(db.prepare('PRAGMA table_info(vela_api_tool_receipts)').all().map(row=>row.name));
    for(const column of ['workflow_id','continuation_json','continuation_digest','continuation_state'])if(!toolColumns.has(column))db.exec('ALTER TABLE vela_api_tool_receipts ADD COLUMN '+column+' TEXT');
    // An interrupted transport has no confirmed outcome. No automatic replay or invented remote failure.
    db.prepare("UPDATE vela_api_runs SET state='unknown',error_code=COALESCE(error_code,'api_process_interrupted') WHERE state='dispatching'").run();
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
  nonMissionInFlight() { return [...this.running.values()].filter(lane => lane !== 'mission-specialist').length; }
  availability() { const available = this.authorized(); return { available, busy: this.running.size >= VELA_API_RUNTIME_LIMITS.concurrent,
    ...(!available ? { reason: 'Dedicated Vela API usage has not been authorized for this configuration.' } : {}) }; }
  private validate(version: number) { check(this.authorized(version), 'vela_api_usage_authorization_required'); }
  async models(version: number): Promise<string[]> {
    this.validate(version);
    if (this.catalogFlight?.version === version) return [...await this.catalogFlight.promise];
    const promise = this.loadModels(version);
    const flight = { version, promise }; this.catalogFlight = flight;
    try { return [...await promise]; }
    finally { if (this.catalogFlight === flight) this.catalogFlight = undefined; }
  }
  private async loadModels(version: number): Promise<string[]> {
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
  receiptsForRequest(requestId: string):VelaApiRunReceipt[] {
    return this.options.db.prepare('SELECT execution_id AS executionId,body_digest AS bodyDigest,context_digest AS contextDigest,state,response_id AS responseId,elapsed_ms AS elapsedMs,error_code,http_diagnostic_json FROM vela_api_runs WHERE request_id=? ORDER BY rowid LIMIT 12').all(requestId).map(row=>{
      let httpDiagnostic:unknown;try{if(typeof row.http_diagnostic_json==='string'&&Buffer.byteLength(row.http_diagnostic_json)<=2048)httpDiagnostic=JSON.parse(row.http_diagnostic_json);}catch{}
      const {error_code,http_diagnostic_json,...receipt}=row;
      return {...receipt,...apiRunDiagnostics({errorCode:error_code,httpDiagnostic})} as unknown as VelaApiRunReceipt;
    });
  }
  retainContinuation(workflowId:string,value:VelaApiToolContinuation):VelaApiToolContinuationRef{
    const text=JSON.stringify(value);check(value.workflowId===workflowId&&value.pending.length>0&&Buffer.byteLength(text)<=VELA_TOOL_LIMITS.continuationBytes,'vela_tool_continuation_capacity');
    const first=value.receipts.find(item=>item.callId===value.pending[0].call.callId);check(first,'api_tool_receipt_mismatch');const ref={id:first.receiptId,digest:digest(text)};
    this.options.transaction(()=>{const row=this.options.db.prepare('SELECT execution_id FROM vela_api_tool_receipts WHERE receipt_id=?').get(ref.id);check(row,'api_tool_receipt_mismatch');this.options.db.prepare("UPDATE vela_api_tool_receipts SET workflow_id=?,continuation_json=?,continuation_digest=?,continuation_state='paused' WHERE receipt_id=?").run(workflowId,text,ref.digest,ref.id);});return ref;
  }
  readContinuation(ref:VelaApiToolContinuationRef,workflowId:string):VelaApiToolContinuation{
    check(ref&&Object.keys(ref).length===2&&typeof ref.id==='string'&&typeof ref.digest==='string','vela_tool_continuation_invalid');const row=this.options.db.prepare("SELECT continuation_json,continuation_digest FROM vela_api_tool_receipts WHERE receipt_id=? AND workflow_id=? AND continuation_state='paused'").get(ref.id,workflowId);
    check(row&&typeof row.continuation_json==='string'&&row.continuation_digest===ref.digest&&digest(row.continuation_json)===ref.digest,'vela_tool_continuation_replayed');const value=parseVelaToolJson(row.continuation_json,VELA_TOOL_LIMITS.continuationBytes) as unknown as VelaApiToolContinuation;check(value.contract==='aerynth.vela.tool-continuation@1'&&value.workflowId===workflowId,'vela_tool_continuation_invalid');return value;
  }
  async run(input: VelaApiRun, signal: AbortSignal):Promise<VelaApiRunResult> {
    check(!input.weatherTool||input.lane!=='mission-specialist','weather_tool_not_allowed_for_mission');
    check(!input.tools||input.lane!=='mission-specialist','vela_tools_not_allowed_for_mission');
    check(!input.resume&&!input.resumeReceipt||!!input.tools,'vela_tool_continuation_invalid');
    const transitionKeys=['priorContextDigest','nextContextDigest','ownerReceiptId','sourceProofDigest'];
    if(input.resumeContext)check(input.resume&&input.resumeReceipt&&input.tools&&typeof input.validateResumeContext==='function'&&Object.keys(input.resumeContext).length===4&&transitionKeys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(input.resumeContext!,key)??{},'value')&&typeof(input.resumeContext as any)[key]==='string')&&/^[a-f0-9]{64}$/.test(input.resumeContext.priorContextDigest)&&/^[a-f0-9]{64}$/.test(input.resumeContext.nextContextDigest)&&/^[a-f0-9]{64}$/.test(input.resumeContext.sourceProofDigest)&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(input.resumeContext.ownerReceiptId),'vela_tool_context_transition_invalid');
    const transition=input.resumeContext?Object.freeze({...input.resumeContext}):undefined;
    if(input.advanceContext)check(input.tools&&typeof input.validateResumeContext==='function','vela_tool_context_transition_invalid');
    let currentPrompt=input.prompt,currentContext=input.contextDigest,currentTransition=transition;
    check(this.running.size < VELA_API_RUNTIME_LIMITS.concurrent && !this.running.has(input.requestId) && !this.lifetime.signal.aborted, 'vela_api_busy');
    this.validate(input.version); input.validate();
    const reasoningEfforts = velaApiReasoningEfforts(input.model);
    check(input.reasoningEffort === undefined || reasoningEfforts.includes(input.reasoningEffort), 'unsupported_reasoning_effort');
    check(input.resume||!(input.oneUse||input.tools) || !this.options.db.prepare('SELECT 1 FROM vela_api_runs WHERE request_id=?').get(input.requestId), 'api_execution_already_dispatched');
    const semantic=input.tools,catalog=semantic?validateVelaToolCatalog(semantic.catalog):undefined;
    const selectionDigest=digest(JSON.stringify({prompt:input.prompt,instruction:input.instruction??null,model:input.model,effort:input.reasoningEffort??null}));
    const controlDigest=digest(JSON.stringify({instruction:input.instruction??null,model:input.model,effort:input.reasoningEffort??null})),identityDigest=digest(JSON.stringify({requestId:input.requestId,version:input.version,contextDigest:input.contextDigest,selectionDigest}));
    let restored=semantic&&input.resume?this.readContinuation(input.resume,semantic.workflowId):undefined;
    const deadline=restored?.deadline??Math.min(Date.now()+90000,semantic?Date.parse(semantic.budget.deadline):Infinity);
    check(Number.isFinite(deadline),'vela_workflow_budget_invalid');
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(Math.max(1,Math.floor(deadline-Date.now())))]);
    const receipts = new Map<string, ApiToolOutput>(), items: ApiResponseItem[] = [], fetched = new Set<string>();
    const fetchedSchemas=new Map<string,string>(),invokedIds=new Set<string>();let outputBytes=0,invoking=false;
    let pending:VelaApiToolContinuation['pending']=[];
    let continuation: ApiContinuation | undefined, calls = 0, final:VelaApiRunResult|undefined;
    const definitions: ReviewedApiFunction[] = [];
    if(input.weatherTool)definitions.push(WEATHER_TOOL);
    if(catalog)definitions.push(...velaToolDefinitions(catalog));
    if (input.catalog) {
      const tool = capabilitySchemaTool(input.catalog.projection);
      const nativeParameters = structuredClone(tool.inputSchema);
      const { uniqueItems: _nativeUniqueness, ...ids } = nativeParameters.properties.ids;
      const parameters = { ...nativeParameters, properties: { ...nativeParameters.properties, ids: { ...ids, items: { type: 'string', ...ids.items } } } };
      const definition = { type: 'function' as const, name: tool.name, description: tool.description, parameters: parameters as unknown as ApiJsonSchema, strict: true as const };
      definitions.push({ definition, schemaDigest: digest(JSON.stringify(definition)), authorizationRef: 'vela-api-schema:' + input.catalog.projection.digest });
    }
    const fence = () => {check(identityDigest===digest(JSON.stringify({requestId:input.requestId,version:input.version,contextDigest:input.contextDigest,selectionDigest:digest(JSON.stringify({prompt:input.prompt,instruction:input.instruction??null,model:input.model,effort:input.reasoningEffort??null}))})),'vela_tool_run_binding_changed');if(transition)check(transitionKeys.every(key=>(input.resumeContext as any)?.[key]===(transition as any)[key]),'vela_tool_context_transition_invalid');if(currentTransition)input.validateResumeContext!(currentTransition,{contextDigest:currentContext,promptDigest:digest(currentPrompt)});if(semantic){check(Number.isFinite(deadline)&&Date.now()<deadline,'vela_workflow_budget_exhausted');const budget=semantic.budget;check(Number.isSafeInteger(budget.maxProviderRequests)&&budget.maxProviderRequests>=0&&budget.maxProviderRequests<=12&&Number.isSafeInteger(budget.maxToolCalls)&&budget.maxToolCalls>=0&&budget.maxToolCalls<=16&&Number.isSafeInteger(budget.providerRequests)&&budget.providerRequests>=0&&budget.providerRequests<=budget.maxProviderRequests&&Number.isSafeInteger(budget.toolCalls)&&budget.toolCalls>=0&&budget.toolCalls<=budget.maxToolCalls&&Date.parse(budget.deadline)>=deadline,'vela_workflow_budget_invalid');check(semantic.catalog.digest===catalog!.digest&&semantic.catalog.scopeDigest===catalog!.scopeDigest&&velaToolCatalogDigest(semantic.catalog)===catalog!.digest,'vela_tool_catalog_changed');semantic.validate();}check(!combined.aborted, 'vela_execution_cancelled'); this.validate(input.version); input.validate(); };
    const checkpoint=(phase:VelaWorkflowPhase,reason?:string)=>{semantic?.checkpoint(phase,reason);};
    const outputFinal=(phase:VelaWorkflowPhase,reason?:string,ref?:VelaApiToolContinuationRef):VelaApiRunResult=>{check(final,'vela_workflow_budget_exhausted');checkpoint(phase,reason);return {...final,workflow:{workflowId:semantic!.workflowId,phase,...(reason?{reason}:{}),...(ref?{continuation:ref,pendingReceiptIds:pending.map(item=>item.receipt.id)}:{})}};};
    const pause=()=>{check(semantic&&continuation&&final&&pending.length,'vela_tool_continuation_invalid');const state:VelaApiToolContinuation={contract:'aerynth.vela.tool-continuation@1',workflowId:semantic.workflowId,requestId:input.requestId,version:input.version,contextDigest:currentContext,selectionDigest:digest(JSON.stringify({prompt:currentPrompt,instruction:input.instruction??null,model:input.model,effort:input.reasoningEffort??null})),controlDigest,catalogDigest:catalog!.digest,deadline,providerRequests:semantic.budget.providerRequests,toolCalls:semantic.budget.toolCalls,maxProviderRequests:semantic.budget.maxProviderRequests,maxToolCalls:semantic.budget.maxToolCalls,budgetDeadline:semantic.budget.deadline,fetchedSchemas:[...fetchedSchemas],invokedIds:[...invokedIds],outputBytes,items:structuredClone(items),receipts:[...receipts.values()],fetchedIds:[...fetched],continuation,final,pending};const ref=this.retainContinuation(semantic.workflowId,state);return outputFinal(pending.some(item=>item.receipt.pause==='native-review')?'awaiting-review':'waiting-job',undefined,ref);};
    const saveOutput=(call:ApiFunctionCall,executionId:string,output:string)=>{check(Buffer.byteLength(output)<=VELA_API_RUNTIME_LIMITS.toolBytes,'capability_discovery_response_budget_exceeded');if(semantic){outputBytes+=Buffer.byteLength(output);check(outputBytes<=VELA_TOOL_LIMITS.totalOutputBytes,'vela_tool_output_capacity');}const receiptId=randomUUID(),receipt={callId:call.callId,name:call.name,argumentsDigest:call.argumentsDigest,output,receiptId};this.options.transaction(()=>{fence();this.options.db.prepare('INSERT INTO vela_api_tool_receipts(receipt_id,execution_id,call_id,arguments_digest,output_digest) VALUES(?,?,?,?,?)').run(receiptId,executionId,call.callId,call.argumentsDigest,digest(output));});receipts.set(call.callId,receipt);};
    this.running.set(input.requestId, input.lane);
    try {
      fence();
      if(restored){
        const sourceContext=restored.continuation.contextDigest,contextMoved=sourceContext!==input.contextDigest;
        check(semantic&&input.resume&&input.resumeReceipt&&restored.requestId===input.requestId&&restored.version===input.version&&(contextMoved?transition&&transition.priorContextDigest===sourceContext&&transition.nextContextDigest===input.contextDigest&&restored.controlDigest===controlDigest:!transition&&restored.contextDigest===input.contextDigest&&restored.selectionDigest===selectionDigest)&&restored.catalogDigest===catalog!.digest&&restored.providerRequests<=semantic.budget.providerRequests&&restored.toolCalls===semantic.budget.toolCalls&&semantic.budget.maxProviderRequests<=restored.maxProviderRequests&&semantic.budget.maxToolCalls<=restored.maxToolCalls&&restored.budgetDeadline===semantic.budget.deadline,'vela_tool_continuation_invalid');
        const source=this.options.db.prepare('SELECT state,request_id,configuration_version,context_digest,response_id FROM vela_api_runs WHERE execution_id=?').get(restored.final.executionId);
        check(source?.state==='completed'&&source.request_id===input.requestId&&source.configuration_version===input.version&&source.context_digest===sourceContext&&source.response_id===restored.final.result.responseId,'vela_tool_continuation_invalid');
        final=restored.final;items.push(...restored.items);for(const value of restored.receipts)receipts.set(value.callId,value);for(const value of restored.fetchedIds)fetched.add(value);for(const [id,schema]of restored.fetchedSchemas)fetchedSchemas.set(id,schema);for(const id of restored.invokedIds)invokedIds.add(id);pending=restored.pending;outputBytes=restored.outputBytes;continuation=restored.continuation;
        const waiting=pending.find(item=>item.invocation.invocationId===input.resumeReceipt!.invocationId);check(waiting,'vela_tool_resume_receipt_mismatch');const replacement=validateVelaToolReceipt(input.resumeReceipt,{workflowId:semantic.workflowId,requestId:input.requestId,scopeDigest:catalog!.scopeDigest,invocation:waiting.invocation});check(replacement.pause==='none','vela_tool_resume_not_ready');
        if(transition)check(transition.ownerReceiptId===replacement.id||restored.contextDigest===input.contextDigest&&JSON.stringify(restored.continuation.contextTransition)===JSON.stringify(transition),'vela_tool_context_receipt_mismatch');
        const old=receipts.get(waiting.call.callId);check(old,'api_tool_receipt_mismatch');const output=JSON.stringify(replacement);outputBytes+=Buffer.byteLength(output)-Buffer.byteLength(old.output);check(outputBytes<=VELA_TOOL_LIMITS.totalOutputBytes,'vela_tool_output_capacity');
        this.options.transaction(()=>{fence();const changed=this.options.db.prepare("UPDATE vela_api_tool_receipts SET continuation_state='consumed' WHERE receipt_id=? AND continuation_digest=? AND continuation_state='paused'").run(input.resume!.id,input.resume!.digest).changes;check(changed===1,'vela_tool_continuation_replayed');this.options.db.prepare('UPDATE vela_api_tool_receipts SET output_digest=? WHERE receipt_id=?').run(digest(output),old.receiptId);});
        receipts.set(waiting.call.callId,{...old,output});pending=pending.filter(item=>item!==waiting);continuation={...continuation,toolOutputs:[...receipts.values()],...(transition?{contextTransition:transition}:{})};if(replacement.state==='unknown')return outputFinal('unknown','vela_tool_owner_unknown');if(pending.length)return pause();
      }
      for (let stage = 0; stage < (semantic?VELA_TOOL_LIMITS.providerRequests:VELA_API_RUNTIME_LIMITS.stages); stage++) {
        fence();
        if(semantic)check(semantic.budget.providerRequests<semantic.budget.maxProviderRequests,'vela_workflow_budget_exhausted');
        const executionId = randomUUID(), started = performance.now();
        const turn = { executionId, requestId: input.requestId, configurationId: VELA_API_CONFIGURATION_ID, providerId: VELA_API_PROVIDER,
          assistant: 'vela' as const, model: input.model,
          instructions: renderVelaIdentityPrompt('assistant') + '\n' + (input.instruction ?? 'Answer naturally and concisely using the supplied context. Never claim an action occurred without an observed host receipt.')+(catalog?'\nPinned host tools: '+JSON.stringify(velaToolCatalogEnvelope(catalog))+'\nFetch exact schemas before invocation. Tool receipts report actual host outcomes; pending review/job is not completion. Provider reports do not independently verify the objective.':''),
          messages: [{ role: 'user' as const, content: currentPrompt }], contextDigest: currentContext,
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          api: { configurationVersion: input.version, instructionVersion: VELA_IDENTITY_VERSION,
            maxOutputTokens: VELA_API_RUNTIME_LIMITS.maxOutputTokens, ...(definitions.length ? { tools: definitions } : {}),
            ...(semantic?{parallelToolCalls:true as const}:{}),
            ...(input.reasoningEffort ? { reasoningEfforts } : {}),
            ...(input.outputSchema ? { outputFormat: { type: 'json_schema' as const, name: 'vela_scoped_proposal', schema: input.outputSchema, strict: true as const } } : {}),
            ...(continuation ? { continuation } : {}) } };
        const expected = prepareResponsesTurn(turn).review;
        let admitted = false;
        const commitExecution = <T,>(work: () => T) => (this.options.executionTransaction ?? this.options.transaction)(work);
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
              const before = semantic?.budget.providerRequests;
              let afterCommit: void | (() => void);
              try {
                afterCommit = commitExecution(() => {
                  fence(); check(this.usageStatus().usedToday < VELA_API_RUNTIME_LIMITS.requestsPerDay, 'vela_api_daily_limit_reached');
                  if(semantic){check(semantic.budget.providerRequests<semantic.budget.maxProviderRequests,'vela_workflow_budget_exhausted');semantic.budget.providerRequests++;fence();checkpoint('running');}
                  this.options.db.prepare('INSERT INTO vela_api_runs(execution_id,request_id,configuration_version,utc_day,body_digest,context_digest,state) VALUES(?,?,?,?,?,?,?)')
                    .run(executionId,input.requestId,input.version,new Date().toISOString().slice(0,10),review.bodyDigest,currentContext,'dispatching');
                  return input.stage ? input.stage(executionId, review) : this.options.observe?.stage(executionId, input.requestId, review);
                });
              } catch (error) {
                if (semantic && before !== undefined) semantic.budget.providerRequests = before;
                throw error;
              }
              admitted = true;
              afterCommit?.();
            },
            resolveCredential: async (configurationId, providerId) => {
              fence(); check(configurationId === VELA_API_CONFIGURATION_ID && providerId === VELA_API_PROVIDER, 'credential_boundary_mismatch');
              return this.options.connection.resolveNativeCredential(input.version);
            },
            resolveCatalog: async () => {
              fence();
              // A tool loop can outlive the catalog TTL while retaining its
              // original request, model and usage grant. Reuse bounded catalog
              // refresh/coalescing, then recheck every original authority fence.
              await abortable(this.models(input.version), combined);
              fence();
              const current = await abortable(this.options.connection.resolveCatalog(input.version), combined);
              fence();
              return current;
            },
            revalidate: async (review, boundaryDigest) => { exactReview(review); await this.options.connection.revalidate(input.version,boundaryDigest); fence(); },
          } });
        let result = await transport.turn(turn, combined);
        const settle = (receipt: TurnResult) => commitExecution(() => {
          const diagnostic = apiRunDiagnostics(receipt);
          const elapsed = Math.round(performance.now() - started);
          this.options.db.prepare('UPDATE vela_api_runs SET state=?,result_digest=?,response_id=?,usage_json=?,elapsed_ms=?,error_code=?,http_diagnostic_json=? WHERE execution_id=?')
            .run(receipt.outcome, receipt.outcome === 'completed' ? digest(receipt.partialText) : null, receipt.responseId ?? null,
              receipt.usage ? JSON.stringify(receipt.usage) : null, elapsed, diagnostic.errorCode ?? null,
              diagnostic.httpDiagnostic ? JSON.stringify(diagnostic.httpDiagnostic) : null, executionId);
          if (input.completed) input.completed(executionId, receipt);
          else this.options.observe?.completed(executionId, input.requestId, receipt, elapsed);
        });
        if (admitted) {
          try {
            settle(result);
          } catch {
            // The previous commit rolled back. Discard uncommitted output and tool calls.
            const { api: _api, webSearch: _webSearch, ...facts } = result;
            result = { ...facts, partialText: '', outcome: result.dispatched ? 'unknown' : 'failed',
              errorCode: 'vela_api_settlement_unavailable' };
            // A failed fallback must not return a previous tool stage as this one's result.
            final = undefined;
            try { settle(result); }
            catch { throw new VelaError(result.errorCode!, result.dispatched ? 'unknown' : undefined); }
          }
        }
        final = { executionId, result, fetchedIds: [...fetched] };
        if (result.outcome !== 'completed') return semantic?outputFinal(result.outcome==='unknown'?'unknown':'blocked',result.errorCode):final;
        fence();
        if (!result.api?.toolCalls.length) return semantic?outputFinal('partial','provider_report'):final;
        fence(); check(result.responseId, 'unreviewed_api_function');
        const seenCalls=new Set(receipts.keys());
        const admitCall=(call:ApiFunctionCall)=>{
          check(++calls <= (semantic?VELA_TOOL_LIMITS.toolCalls:VELA_API_RUNTIME_LIMITS.discoveryCalls) && call.executionId === executionId &&
            call.configurationVersion === input.version && call.contextDigest === currentContext && call.responseId===result.responseId&&call.argumentsDigest===digest(call.arguments)&&definitions.some(item=>item.definition.name===call.name&&item.schemaDigest===call.schemaDigest)&&!seenCalls.has(call.callId), 'api_tool_call_limit');
          seenCalls.add(call.callId);fence();if(semantic){check(semantic.budget.toolCalls<semantic.budget.maxToolCalls,'vela_workflow_budget_exhausted');semantic.budget.toolCalls++;fence();checkpoint('running');}
        };
        let ownerUnknown=false;const stageReceipts:VelaToolReceipt[]=[];
        const invokeOwner=async(call:ApiFunctionCall,invocation:VelaToolInvocation)=>{check(semantic,'unreviewed_api_function');invoking=true;const receipt=await abortable(semantic.invoke(invocation,combined),combined);fence();return validateVelaToolReceipt(receipt,{workflowId:semantic.workflowId,requestId:input.requestId,scopeDigest:catalog!.scopeDigest,invocation});};
        const saveOwner=(call:ApiFunctionCall,invocation:VelaToolInvocation,receipt:VelaToolReceipt)=>{saveOutput(call,executionId,JSON.stringify(receipt));stageReceipts.push(receipt);if(receipt.pause!=='none')pending.push({call,invocation,receipt});if(receipt.state==='unknown')ownerUnknown=true;};
        for(let index=0;index<result.api.toolCalls.length;index++){
          const call=result.api.toolCalls[index];
          if(semantic&&call.name===VELA_TOOL_INVOKE){
            const invocation=velaToolInvocation(catalog!,call.arguments,fetchedSchemas,invokedIds),next=result.api.toolCalls[index+1];
            let other:VelaToolInvocation|undefined;
            if(next?.name===VELA_TOOL_INVOKE){const candidate=velaToolInvocation(catalog!,next.arguments,fetchedSchemas,new Set([...invokedIds,invocation.invocationId]));if(velaToolsMayRunTogether(catalog!,invocation,candidate))other=candidate;}
            admitCall(call);invokedIds.add(invocation.invocationId);
            if(other&&next){admitCall(next);invokedIds.add(other.invocationId);const outcomes=await Promise.allSettled([invokeOwner(call,invocation),invokeOwner(next,other)]);for(let part=0;part<outcomes.length;part++){const outcome=outcomes[part];if(outcome.status==='fulfilled')saveOwner(part?next:call,part?other:invocation,outcome.value);else ownerUnknown=true;}index++;invoking=false;if(ownerUnknown)return outputFinal('unknown','vela_tool_owner_unknown');}
            else{const receipt=await invokeOwner(call,invocation);saveOwner(call,invocation,receipt);invoking=false;if(ownerUnknown)return outputFinal('unknown','vela_tool_owner_unknown');}
            continue;
          }
          admitCall(call);
          let output:string;
          if(call.name===WEATHER_TOOL_NAME){
            check(input.weatherTool&&input.lane!=='mission-specialist','unreviewed_api_function');
            check(Buffer.byteLength(call.arguments)<=1024,'invalid_weather_tool_arguments');
            let query:unknown;try{query=JSON.parse(call.arguments);}catch{throw new VelaError('invalid_weather_tool_arguments');}
            check(validWeatherQuery(query),'invalid_weather_tool_arguments');fence();
            let data:WeatherData;
            try{data=await abortable(input.weatherTool.run(query,combined),combined);}catch{fence();throw new VelaError('weather_tool_unavailable');}
            fence();data=validateWeatherData(data);output=JSON.stringify(data);
            check(Buffer.byteLength(output)<=8192,'weather_tool_output_budget_exceeded');
          }else if(semantic&&(call.name===VELA_TOOL_DISCOVER||call.name===VELA_TOOL_SCHEMAS)){
            const discovery=velaToolDiscovery(catalog!,call.name,call.arguments);output=discovery.output;saveOutput(call,executionId,output);
            if(discovery.schemas.length){for(const schema of discovery.schemas)fetchedSchemas.set(schema.id,schema.schemaDigest);fence();semantic.discovered({executionId,callId:call.callId,catalogDigest:catalog!.digest,schemas:discovery.schemas});fence();}
            continue;
          }else{
            check(call.name===CAPABILITY_SCHEMA_TOOL&&input.catalog,'unreviewed_api_function');
            const query = JSON.parse(call.arguments);
            check(query && typeof query === 'object' && !Array.isArray(query) && Object.keys(query).length === 2 &&
              query.catalogDigest === input.catalog.projection.digest && Array.isArray(query.ids) && query.ids.length >= 1 && query.ids.length <= 4 &&
              new Set(query.ids).size === query.ids.length && query.ids.every((id: unknown) => typeof id === 'string' && input.catalog!.descriptors.some(item => item.id === id)), 'invalid_capability_schema_query');
            fence();
            output = JSON.stringify({ catalogDigest: input.catalog.projection.digest, descriptors: input.catalog.descriptors.filter(item => query.ids.includes(item.id)) });
            query.ids.forEach((id:string)=>fetched.add(id));
          }
          saveOutput(call,executionId,output);
        }
        items.push(...result.api.outputItems);
        if(semantic)check(Buffer.byteLength(JSON.stringify(items))<=65536,'vela_tool_continuation_capacity');
        continuation = { sourceExecutionId: executionId, responseId: result.responseId, configurationVersion: input.version,
          contextDigest: currentContext, sourceOutcome: 'completed', itemsDigest: digest(JSON.stringify(items)), items: structuredClone(items), toolOutputs: [...receipts.values()] };
        const changes=stageReceipts.filter(receipt=>receipt.state==='observed'&&receipt.verification.kind==='owner-observed'&&catalog?.descriptors.some(descriptor=>descriptor.id===receipt.capabilityId&&descriptor.effect==='mutate'));
        if(changes.length&&input.advanceContext){fence();const advance=await abortable(Promise.resolve(input.advanceContext(changes)),combined);if(advance){const proof=advance.resumeContext;check(typeof advance.prompt==='string'&&Buffer.byteLength(advance.prompt)<=65536&&typeof advance.contextDigest==='string'&&/^[a-f0-9]{64}$/.test(advance.contextDigest)&&proof&&Object.keys(proof).length===4&&transitionKeys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(proof,key)??{},'value')&&typeof(proof as any)[key]==='string')&&proof.priorContextDigest===continuation.contextDigest&&proof.nextContextDigest===advance.contextDigest&&proof.nextContextDigest!==proof.priorContextDigest&&/^[a-f0-9]{64}$/.test(proof.sourceProofDigest)&&changes.some(receipt=>receipt.id===proof.ownerReceiptId),'vela_tool_context_transition_invalid');currentPrompt=advance.prompt;currentContext=advance.contextDigest;currentTransition=Object.freeze({...proof});continuation={...continuation,contextTransition:currentTransition};fence();}}
        if(pending.length)return pause();
      }
      throw new VelaError('api_tool_call_limit');
    } catch(error){
      // A workflow checkpoint cannot downgrade an uncertain dispatched stage.
      if (error instanceof VelaError && error.outcome === 'unknown') throw error;
      if (final?.result.outcome === 'unknown')
        throw new VelaError(final.result.errorCode ?? 'vela_api_unknown', 'unknown');
      if(semantic){const code=String((error as {code?:string})?.code??''),reason=code==='vela_workflow_budget_exhausted'?code:invoking?'vela_tool_owner_unknown':/^vela_tool_[a-z_]{1,64}$/.test(code)?code:'vela_tool_rejected',phase=reason==='vela_workflow_budget_exhausted'?'budget-exhausted':invoking?'unknown':'blocked';checkpoint(phase,reason);if(final)return {...final,workflow:{workflowId:semantic.workflowId,phase,reason}};}throw error;
    } finally { this.running.delete(input.requestId); }
  }
  async structuredProposal(input: { instruction: string; payload: unknown; schema: ApiJsonSchema; requestId: string; model?:string;reasoningEffort?:ReasoningEffort;weatherTool?:VelaApiWeatherTool;onResult?(result:TurnResult):void;
    /** Native binding for a reviewed cognitive payload and its current source provenance. */
    binding?: { configurationVersion: number; contextDigest: string };
    validate(): void }, signal: AbortSignal): Promise<unknown> {
    const version = this.configurationVersion(); check(version !== null, 'api_configuration_disconnected');
    const binding = input.binding;
    if (binding) {
      check(binding.configurationVersion === version && /^[a-f0-9]{64}$/.test(binding.contextDigest), 'api_configuration_changed');
      input.validate();
    }
    const model=input.model??'gpt-6-luna',models = await this.models(version); check(models.includes(model), 'vela_api_default_model_unavailable');
    const prompt = JSON.stringify(input.payload); check(Buffer.byteLength(prompt) <= 32768, 'context_budget_exceeded');
    const reasoningEffort = input.reasoningEffort ?? (binding ? undefined : 'low');
    const { result } = await this.run({ requestId: input.requestId, version, model, prompt,
      instruction: input.instruction, ...(reasoningEffort ? { reasoningEffort } : {}),
      contextDigest: binding?.contextDigest ?? digest(prompt), ...(binding ? { oneUse: true as const } : {}),
      outputSchema: input.schema,...(input.weatherTool?{weatherTool:input.weatherTool}:{}),validate: input.validate }, signal);
    input.onResult?.(result);
    check(result.outcome === 'completed', result.errorCode ?? 'vela_api_proposal_failed');
    if (binding) {
      input.validate();
      check(result.responseId && result.reportedModel === model && !result.refusalText, 'vela_api_proposal_unconfirmed');
      const items = result.api?.outputItems.filter(item => item.type !== 'reasoning') ?? [];
      const [message] = items;
      check(items.length === 1 && message.type === 'message' && message.status === 'completed' && message.content.length === 1, 'vela_api_proposal_unconfirmed');
      const [output] = message.content;
      check(output.type === 'output_text' && output.text === result.partialText && Buffer.byteLength(output.text) <= 8192, 'vela_api_proposal_unconfirmed');
    }
    try{return JSON.parse(result.partialText);}catch{throw new VelaError('vela_api_proposal_invalid');}
  }
  close() { this.lifetime.abort(); }
}
