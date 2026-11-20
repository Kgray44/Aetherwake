import { readBounded } from './github.mjs';
import { openAIModelPage, openAIModelSlug } from '../src/openai-pricing.mjs';

const refreshInterval = 6 * 60 * 60 * 1000;
const retryInterval = 15 * 60 * 1000;
const maxModels = 64;

export function parseOpenAIModelPricing(model, markdown) {
  if (!openAIModelSlug.test(model)) return null;
  const lines = markdown.split(/\r?\n/);
  const identity = lines.flatMap(line => line.match(/^Model ID: `([^`]+)`\s*$/)?.[1] ?? []);
  if (identity.length !== 1 || identity[0] !== model) return null;
  const pricingStart = lines.findIndex(line => line.trim() === '## Pricing');
  if (pricingStart < 0) return null;
  const nextSection = lines.findIndex((line, index) => index > pricingStart && /^#{1,2}\s/.test(line));
  const pricing = lines.slice(pricingStart + 1, nextSection < 0 ? undefined : nextSection);
  const textStart = pricing.findIndex(line => line.trim() === '### Text tokens');
  if (textStart < 0) return null;
  const tableEnd = pricing.findIndex((line, index) => index > textStart && /^#{1,3}\s/.test(line));
  const table = pricing.slice(textStart + 1, tableEnd < 0 ? undefined : tableEnd);
  const usdPerMillion = {};
  const metrics = [['Input', 'input'], ['Cached input', 'cachedInput'], ['Output', 'output']];
  for (const [label, key] of metrics) {
    const rows = table.map(line => line.trim().split('|').map(cell => cell.trim())).filter(cells => cells[1] === label);
    const amount = rows[0]?.[2];
    if (rows.length !== 1 || rows[0].length !== 5 || rows[0][3] !== '1M tokens' ||
        !/^\$\d+(?:\.\d+)?$/.test(amount)) return null;
    const rate = Number(amount.slice(1));
    if (!Number.isFinite(rate)) return null;
    usdPerMillion[key] = rate;
  }
  return usdPerMillion;
}

export function createOpenAIModelPricing(fetcher, clock = Date.now) {
  const rates = new Map();
  return async model => {
    if (!openAIModelSlug.test(model)) return null;
    const existing = rates.get(model);
    if (existing?.expires > clock()) return existing.result;
    rates.delete(model);
    if (rates.size >= maxModels) rates.delete(rates.keys().next().value);
    const entry = {expires: Infinity};
    rates.set(model, entry);
    entry.result = (async () => {
      let quote = null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetcher(openAIModelPage(model) + '.md', {
          headers: {accept: 'text/markdown'}, redirect: 'manual', signal: controller.signal,
        });
        const mediaType = response.headers.get('content-type')?.split(';')[0];
        if (response.ok && mediaType === 'text/markdown') {
          const usdPerMillion = parseOpenAIModelPricing(model, await readBounded(response.body, 64 * 1024));
          if (usdPerMillion) {
            const retrieved = clock();
            quote = {model, usdPerMillion, retrievedAt: new Date(retrieved).toISOString(),
              expiresAt: new Date(retrieved + refreshInterval).toISOString()};
          } else console.warn('OpenAI pricing document layout unrecognized', model);
        } else if (response.status !== 404) {
          console.warn('OpenAI pricing response unavailable', model, response.status, mediaType);
        }
      } catch (error) {
        console.warn('OpenAI pricing retrieval failed', model, String(error).slice(0, 180));
      } finally {
        clearTimeout(timeout);
      }
      entry.expires = quote ? Date.parse(quote.expiresAt) : clock() + retryInterval;
      return quote;
    })();
    return entry.result;
  };
}
