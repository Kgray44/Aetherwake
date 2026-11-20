export const openAIModelSlug = /^(?:gpt-[a-z0-9][a-z0-9.-]{0,70}|o[1-9][a-z0-9.-]{0,70})$/;
export const openAIModelPage = model => 'https://developers.openai.com/api/docs/models/' + model;
export const openAIReferenceBasis = 'Current published OpenAI Standard API text rates for short context. Actual charges and signed-in Codex billing are unknown.';
export const formatReferenceCost = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 8,
}).format;

export function estimateOpenAIReference(rows, pricing, now) {
  const attempts = rows.flatMap(row => {
    const price = Object.hasOwn(pricing, row.model) && pricing[row.model];
    const {inputTokens, cachedInputTokens, outputTokens, totalTokens, cacheWriteInputTokens} = row.observed;
    const rate = price?.usdPerMillion;
    if (row.provider !== 'openai' || price?.model !== row.model || !openAIModelSlug.test(row.model) ||
        !(Date.parse(price.retrievedAt) <= now && now < Date.parse(price.expiresAt)) ||
        !rate || ![rate.input, rate.cachedInput, rate.output].every(value => Number.isFinite(value) && value >= 0) ||
        ![inputTokens, cachedInputTokens, outputTokens, totalTokens].every(value => Number.isSafeInteger(value) && value >= 0) ||
        cachedInputTokens > inputTokens || inputTokens + outputTokens !== totalTokens || cacheWriteInputTokens !== 0) return [];
    const usd = ((inputTokens - cachedInputTokens) * rate.input + cachedInputTokens * rate.cachedInput +
      outputTokens * rate.output) / 1_000_000;
    return [{attemptId: row.attemptId, attemptNumber: row.attemptNumber, model: row.model, usd, rate,
      source: openAIModelPage(row.model), retrievedAt: price.retrievedAt}];
  });
  return {attempts, total: attempts.length ? attempts.reduce((sum, row) => sum + row.usd, 0) : null};
}
