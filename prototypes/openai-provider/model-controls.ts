export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type OrdinaryHostedTool = 'web_search';
export type OrdinaryModelOption = {
  id: string;
  label: string;
  reasoningEfforts?: readonly ReasoningEffort[];
  eligibleTools?: readonly OrdinaryHostedTool[];
};

const advanced = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'] as const);
const optionalThinking = Object.freeze(['none', ...advanced] as const);
const previous = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh'] as const);
const webSearch = Object.freeze(['web_search'] as const);

// Exact model slugs reviewed against the corresponding official model pages:
// https://developers.openai.com/api/docs/models
// The authenticated plan catalog supplies model visibility, not these options.
// https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
// Web search remains subject to model and account/workspace policy:
// https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
const publishedControls = new Map<string, Pick<OrdinaryModelOption, 'reasoningEfforts' | 'eligibleTools'>>([
  ['gpt-6-astra', { reasoningEfforts: advanced, eligibleTools: webSearch }],
  ['gpt-6.1-sol', { reasoningEfforts: advanced, eligibleTools: webSearch }],
  ['gpt-6.1-terra', { reasoningEfforts: optionalThinking, eligibleTools: webSearch }],
  ['gpt-6-sol', { reasoningEfforts: optionalThinking, eligibleTools: webSearch }],
  ['gpt-6-luna', { reasoningEfforts: optionalThinking, eligibleTools: webSearch }],
  ['gpt-5.5', { reasoningEfforts: previous, eligibleTools: webSearch }],
  ['gpt-5.4', { reasoningEfforts: previous, eligibleTools: webSearch }],
  ['gpt-5.4-mini', { reasoningEfforts: previous, eligibleTools: webSearch }],
]);

export function ordinaryModelOption(model: { id: string; label: string }): OrdinaryModelOption {
  return { id: model.id, label: model.label, ...publishedControls.get(model.id) };
}

export function supportsOrdinaryReasoning(model: string, effort: unknown): effort is ReasoningEffort {
  return publishedControls.get(model)?.reasoningEfforts?.some(option => option === effort) ?? false;
}

export function supportsOrdinaryWebSearch(model: string): boolean {
  return publishedControls.get(model)?.eligibleTools?.includes('web_search') ?? false;
}
