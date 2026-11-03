import type { VelaLocalCapabilityId, VelaProjectCheckKind } from './contracts.ts';
import type { OrdinaryModelOption, ReasoningEffort } from '../../openai-provider/model-controls.ts';
import { calculatorExpression } from './calculator.ts';
import type { VelaCalibrationComparison } from './routing-calibration.ts';

export type VelaRoutingIntent = 'quick' | 'deep' | 'app-planning' | 'local-read' | 'local-write' | 'project-check';
export type VelaMode = 'auto' | 'fast' | 'deep' | 'codex' | 'custom';
export interface VelaTurnRouting {
  mode?: VelaMode;
  providerId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  allowEscalation?: true;
  includeRecentHistory?: true;
  handoffSourceRequestId?: string;
  routingAgentId?: string;
  overrideDefaults?: true;
  /** Hard user cap. Paid routes with unknown metering fail admission. */
  budgetLimit?: number;
}
type AgenticSelection = { model?: string; effort?: ReasoningEffort; environment: 'local-read-only' };
type NativePerformanceMetric = 'system.cpu' | 'system.gpu' | 'system.performance' | 'system.memory';
export type VelaRouteDecision =
  | { kind: 'conversational'; depth: 'quick' | 'deep'; reason: 'routine-answer' | 'complex-analysis'; model: string; effort?: ReasoningEffort;
      nativeMetric?: NativePerformanceMetric;
      calibration?: VelaCalibrationComparison;
      escalation?: { model: string; effort: ReasoningEffort; trigger: 'output-token-limit' } }
  | { kind: 'app-planning'; reason: 'reviewed-app-action'; model?: string; effort?: ReasoningEffort }
  | { kind: 'file-edit'; reason: 'reviewed-file-replacement' | 'reviewed-file-creation'; environment: 'local-reviewed-replacement'; model?: string; effort?: ReasoningEffort; followUpCheck?: VelaProjectCheckKind; inspectSelectedLogs?: true }
  | { kind: 'project-check'; reason: 'reviewed-local-check'; environment: 'local-read-only'; check: VelaProjectCheckKind; model?: never; effort?: never }
  | ({ kind: 'agentic'; reason: 'local-tools-required' | 'explicit-codex' } & AgenticSelection)
  | ({ kind: 'composite'; reason: 'native-fact-and-local-inspection'; metric: NativePerformanceMetric } & AgenticSelection);

function inspectionMetric(intent: string): NativePerformanceMetric | undefined {
  const fact = nativeVelaFact(intent.replace(/^(?:check|show(?: me)?) (?:the )?(?:current )?ram usage$/iu, 'RAM usage'));
  if (fact === 'system.cpu' || fact === 'system.gpu' || fact === 'system.performance' || fact === 'system.memory') return fact;
}

/** Use a narrow explicit conjunction for the first native-to-Codex workflow. */
export function nativeInspectionStage(intent: string) {
  const parts = /^(.*?)[,;.]?\s+(?:and\s+)?then\s+(.+)$/iu.exec(intent);
  if (!parts || classifyVelaRoutingIntent(parts[2]) !== 'local-read') return;
  return inspectionMetric(parts[1]);
}

/** Only an explicit measure, explain, then execute sequence stages two providers. */
export function nativeConversationalWorkflow(intent: string) {
  const text = intent.trim().replace(/^vela[,:]?\s+/iu, '');
  const split = text.search(/[,;]/u);
  if (split < 1) return;
  const metric = inspectionMetric(text.slice(0, split));
  if (!metric) return;
  const parts = /^\s*(?:and\s+)?((?:explain|analyze|summarize)\b.+?)[,;]?\s+(?:and\s+)?then\s+(.+)$/iu.exec(text.slice(split + 1));
  if (!parts) return;
  const execution = classifyVelaRoutingIntent(parts[2]);
  if (execution === 'local-read' || execution === 'local-write' && velaFileEditSelection(parts[2]))
    return { metric, analysisIntent: parts[1], nextIntent: parts[2] };
}

/** Only complete, single-purpose device queries can bypass the provider path. */
export function nativeVelaFact(intent: string): VelaLocalCapabilityId | undefined {
  const text = intent.normalize('NFKC').toLowerCase().trim()
    .replace(/^vela[,:]?\s+/u, '').replaceAll('’', "'").replace(/\s+/gu, ' ')
    .replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/u, '').replace(/[?.!]+$/u, '').replace(/,?\s+please$/u, '');
  if (/^(?:how much (?:ram|memory|physical memory) (?:am i using|is (?:my (?:computer|pc|system)|this (?:computer|pc|system)) using|is (?:currently )?(?:in use|being used))|(?:what(?:'s| is) )?(?:(?:my|the|this (?:pc|computer)'s) )?(?:current )?(?:system )?(?:ram|physical memory) (?:usage|utilization))(?: (?:right now|now|currently|on (?:my|this) (?:pc|computer|system)))?$/u.test(text))
    return 'system.memory';
  const usage = /^(?:(?:what(?:'s| is)|show(?: me)?|check) )?(?:(?:my|the) )?(?:current )?(cpu|gpu|cpu and gpu|gpu and cpu) (?:usage|utilization|load)(?: (?:right now|now|currently))?$/u.exec(text);
  if (usage) return usage[1] === 'cpu' ? 'system.cpu' : usage[1] === 'gpu' ? 'system.gpu' : 'system.performance';
  const busy = /^how busy (?:is|are) (?:my|the) (cpu|gpu|cpu and gpu|gpu and cpu)(?: (?:right now|now|currently))?$/u.exec(text);
  if (busy) return busy[1] === 'cpu' ? 'system.cpu' : busy[1] === 'gpu' ? 'system.gpu' : 'system.performance';
  if (/^(?:which workspace (?:is open|am i in)|what workspace am i in|what(?:'s| is) my current workspace|is (?:the|my|this) workspace saved)$/u.test(text)) return 'local.workspace-status';
  if (/^how many (?:active )?(?:aerynth )?projects (?:are there|do i have)$/u.test(text)) return 'local.project-count';
  if (/^(?:are any (?:aerynth )?executions running|how many (?:aerynth )?executions are running)$/u.test(text)) return 'local.execution-status';
  if (calculatorExpression(intent)) return 'local.calculator';
}

export function nativeVelaWeather(intent: string): 'now' | 'today' | 'tonight' | 'tomorrow' | 'tomorrow-morning' | undefined {
  const text = fileEditIntent(intent).replaceAll('’', "'").replace(/[?.!]+$/u, '').replace(/,?\s+please$/u, '');
  const request = /^(?:will it (?:rain|snow)|(?:what(?:'s| is)|show(?: me)?) (?:the |my )?(?:local )?(?:weather|forecast)(?: like)?)(?: here)?(?: (right now|now|today|tonight|tomorrow morning|tomorrow))?$/u.exec(text);
  const period = request?.[1];
  if (!request) return;
  if (period === 'tomorrow morning') return 'tomorrow-morning';
  if (period === 'today' || period === 'tonight' || period === 'tomorrow') return period;
  return 'now';
}

export function classifyVelaRoutingIntent(intent: string): VelaRoutingIntent {
  const text = fileEditIntent(intent);
  const explanatory = /^(?:explain|how (?:can|could|should|do|does|would|to)|what (?:is|are|would)|(?:give|show) (?:me )?an example)\b/u.test(text);
  if (standaloneVelaProjectCheck(intent)) return 'project-check';
  if (explicitFileCreation(fileEditIntent(intent))) return 'local-write';
  const localObject = /\b(?:files?|code|repo(?:sitory)?|bug|tests?|commands?|scripts?|shell|build|branch|app|package|logs?)\b|\b[\w-]+\.(?:md|json|toml|tsx?|mjs|mts|jsx?|py|rs|cpp|h|css|html|log|txt)\b/u;
  const localAction = /(?:^|[,;]\s*|\b(?:and|then)\s+)(?:(?:please|(?:can|could|would) you)\s+)*(?:fix|patch|edit|modify|update|delete|refactor|implement|run|execute|benchmark|test|build|deploy|install)\b[\s\S]*$/u.exec(text);
  const saveFile = /\b(?:write|save|add|remove|replace)\b[\s\S]*(?:\b(?:to|in|into|from)\s+(?:the\s+|a\s+|my\s+)?(?:files?|repo(?:sitory)?|workspace)\b|\b[\w-]+\.(?:md|json|toml|tsx?|mjs|mts|jsx?|py|rs|cpp|h|css|html|log|txt)\b)/u.test(text);
  if (!explanatory && (saveFile || localAction && localObject.test(localAction[0])))
    return 'local-write';
  if (!explanatory && /\b(?:inspect|read|review|search|check|scan|audit|look (?:at|through)|find)\b[\s\S]*(?:\b(?:files?|source|repo(?:sitory)?|checkout|working tree|logs?|codebase|git diff)\b|\b[\w-]+\.(?:md|json|toml|tsx?|mjs|mts|jsx?|py|rs|cpp|h|css|html|log|txt)\b)/u.test(text))
    return 'local-read';
  const appObject = /\b(?:workspaces?|constellation|blocks?|cards?|checklists?|tasks?|attention mode|conversations?|chats?|collections?|folders?|timelines?|notes?|projects?|resources?)\b/u;
  const appVerb = /^(?:open|navigate|go to|take me|find|create|make|add|start|move|put|rename|call|archive|restore|show|list|organize|set|bring|switch|favou?rite|unfavou?rite|change|edit|mark|link|tidy|apply)\b/u;
  if (appVerb.test(text) && appObject.test(text) ||
    /^(?:keep (?:things|vela) quiet|ask codex to|(?:will it (?:rain|snow)|(?:what(?:'s| is)|show(?: me)?) (?:the |my )?(?:local )?(?:weather|forecast))\b)/u.test(text))
    return 'app-planning';
  if (/\b(?:derive|prove|synthesize|synthesise|trade[- ]offs?|transfer function|scal(?:e|es|ing|ability)|architectur(?:e|al)|rigorous|root cause|step.by.step derivation)\b/u.test(text))
    return 'deep';
  return 'quick';
}

const fileEditIntent = (intent: string) => intent.normalize('NFKC').trim().toLowerCase()
  .replace(/^vela[,:]?\s+/u, '').replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/u, '');
const fileEditParts = (text: string) => text.split(/\s*[,;]\s*|\s+(?:and|then)\s+(?:then\s+)?/u)
  .map(part => part.replace(/^(?:and|then)\s+(?:then\s+)?/u, ''));

export function standaloneVelaProjectCheck(intent: string): VelaProjectCheckKind | undefined {
  const text = fileEditIntent(intent).replace(/[?.!]+$/u, '').replace(/\s+/gu, ' ');
  if (/^(?:run|execute) (?:the |these |selected )?(?:(?:node(?:\.js)?|unit|project) )?tests(?: (?:for|in|on) (?:this|the current) (?:project|checkout|repo(?:sitory)?))?$/u.test(text))
    return 'node-test';
  if (/^(?:type[- ]?check (?:this |the )?(?:typescript )?project|(?:run|execute) (?:the |a )?(?:typescript )?type[- ]?check|check (?:the )?typescript types)$/u.test(text))
    return 'typescript';
  if (/^(?:run (?:the |this |a )?(?:node(?:\.js)? )?benchmark|benchmark (?:this|the) project)$/u.test(text))
    return 'node-benchmark';
  if (/^(?:run (?:the |this |a )?(?:node(?:\.js)? )?build(?: script)?|build (?:this|the) project)$/u.test(text))
    return 'node-build';
}

/** Detect a separately reviewable check explicitly requested after an edit. */
export function velaEditFollowUpCheck(intent: string): VelaProjectCheckKind | undefined {
  const parts = fileEditParts(fileEditIntent(intent));
  if (parts.length < 2) return;
  const last = parts.at(-1)!.replace(/[?.!]+$/u, '');
  if (/^test (?:it|the (?:fix|change|changes))$/u.test(last)) return 'node-test';
  if (/^benchmark(?: (?:it|the (?:fix|change|changes)))?$/u.test(last)) return 'node-benchmark';
  return standaloneVelaProjectCheck(last);
}
const replacementVerb = /^(?:fix|patch|edit|modify|update|refactor|implement|replace|write)\b/u;
const newFile = /^(?:create\s+(?:(?:a|the)\s+)?(?:new\s+)?|(?:add|write)\s+(?:(?:a|the)\s+)?new\s+)(?:(?:source|text|configuration|json|javascript|typescript|markdown|python|css|html)\s+)?file\b/u;
const namedCreation = /^(?:create|add)\s+["'`]?[^\s"'\x60]+\.(?:c|cpp|cs|css|cjs|go|h|html|java|js|json|md|mjs|mts|py|rs|ts|tsx|txt)(?=["'`\s?!.,;]|$)/u;
const explicitFileCreation = (text: string) => newFile.test(text) || namedCreation.test(text);

export function velaEditIncludesLogInspection(intent: string): boolean {
  const parts = fileEditParts(fileEditIntent(intent));
  return /^(?:inspect|read|review|check|look (?:at|through))\b.*\blogs?\b/u.test(parts[0]) &&
    parts.slice(1).some(part => replacementVerb.test(part) && !explicitFileCreation(part));
}

/** File creation needs explicit intent as well as an absent, picked destination. */
export function velaFileEditSelection(intent: string): 'replace' | 'create' | 'mixed' | undefined {
  const text = fileEditIntent(intent);
  if (/\b(?:deploy|delete|publish|install|push)\b/u.test(text)) return;
  const parts = fileEditParts(text);
  const creates = parts.some(explicitFileCreation);
  const replaces = parts.some(part => replacementVerb.test(part) && !explicitFileCreation(part));
  if (explicitFileCreation(parts[0]) || replacementVerb.test(parts[0]) && creates)
    return replaces ? 'mixed' : 'create';
  if (replacementVerb.test(text)) return 'replace';
  if (!creates && velaEditIncludesLogInspection(intent)) return 'replace';
}

export function chooseConversationalModel(
  models: readonly OrdinaryModelOption[], depth: 'quick' | 'deep',
  modelPin?: string, effortPin?: ReasoningEffort,
): { model: string; effort?: ReasoningEffort } | undefined {
  const desired: readonly ReasoningEffort[] = depth === 'quick'
    ? ['none', 'low', 'medium'] : ['high', 'xhigh', 'max', 'medium'];
  const candidates = modelPin ? models.filter(model => model.id === modelPin) : models;
  if (effortPin) {
    const model = candidates.find(item => item.reasoningEfforts?.includes(effortPin));
    return model && { model: model.id, effort: effortPin };
  }
  for (const effort of desired) {
    const model = candidates.find(item => item.reasoningEfforts?.includes(effort));
    if (model) return { model: model.id, effort };
  }
  // Unknown effort is eligible for routine conversation using the provider default.
  const model = candidates[0];
  if (model && (depth === 'quick' || modelPin)) return { model: model.id };
}
