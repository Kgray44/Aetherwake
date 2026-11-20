import { useEffect, useState } from 'react';
import { openAIModelSlug } from './openai-pricing.mjs';

export function useOpenAIPricing(attempts, enabled, headers) {
  const [pricing, setPricing] = useState({});
  const models = JSON.stringify(enabled ? [...new Set(attempts.flatMap(attempt => {
    const provider = attempt.execution_identity?.provider ?? attempt.provider;
    const model = attempt.execution_identity?.model ?? attempt.model;
    return provider === 'openai' && openAIModelSlug.test(model) ? [model] : [];
  }))].sort() : []);

  useEffect(() => {
    const names = JSON.parse(models);
    if (!names.length) return;
    const controller = new AbortController();
    const refresh = async () => {
      const results = await Promise.all(names.map(async model => {
        try {
          const response = await fetch('/api/openai-pricing/' + model, {headers, signal: controller.signal});
          const {pricing: quote} = response.ok ? await response.json() : {};
          return [model, quote?.model === model ? quote : null];
        } catch {
          return [model, null];
        }
      }));
      if (!controller.signal.aborted) setPricing(Object.fromEntries(results));
    };
    refresh();
    const interval = setInterval(refresh, 15 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [models, headers]);

  return {pricing: enabled ? pricing : {}, loadingPrice: JSON.parse(models).some(model => !Object.hasOwn(pricing, model))};
}
