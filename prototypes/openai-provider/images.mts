import { abortable, boundedJSON, digest, ProviderError, record, requireValue, text } from './common.mts';

export const missionImageModel = 'gpt-image-1.5';
export const missionImageSize = 1024;
export const missionImageMaxBytes = 8 * 1024 * 1024;

export function prepareImageGeneration(prompt: string) {
  requireValue(typeof prompt === 'string' && prompt.trim() && Buffer.byteLength(prompt) <= 4096 &&
    !prompt.includes('\0'), 'invalid_image_prompt');
  const body = JSON.stringify({ model: missionImageModel, prompt, n: 1,
    size: `${missionImageSize}x${missionImageSize}`, output_format: 'png', quality: 'low' });
  return { body, digest: digest(body) };
}

/** Sends one admitted request. After dispatch, any unconfirmed result requires reconciliation. */
export async function sendReviewedImageGeneration(review: ReturnType<typeof prepareImageGeneration>, approvedDigest: string,
  apiKey: string, signal: AbortSignal, fetchImage: typeof fetch = fetch) {
  requireValue(review.digest === approvedDigest && digest(review.body) === approvedDigest, 'image_review_changed');
  requireValue(text(apiKey, 2048) && !signal.aborted, 'image_dispatch_unavailable');
  try {
    const response = await abortable(fetchImage('https://api.openai.com/v1/images/generations', {
      method: 'POST', redirect: 'error', signal, body: review.body,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    }), signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderError('image_result_unknown');
    }
    const limit = Math.ceil(missionImageMaxBytes / 3) * 4;
    const result = await boundedJSON(response, limit + 65536, signal);
    requireValue(record(result) && Array.isArray(result.data) && result.data.length === 1, 'invalid_image_result');
    const item = result.data[0];
    requireValue(record(item) && item.url === undefined && typeof item.b64_json === 'string' &&
      item.b64_json.length <= limit, 'invalid_image_result');
    const bytes = Buffer.from(item.b64_json, 'base64');
    requireValue(bytes.length > 0 && bytes.length <= missionImageMaxBytes &&
      bytes.toString('base64') === item.b64_json, 'invalid_image_result');
    const requestId = response.headers.get('x-request-id');
    return { bytes, requestId: text(requestId, 256) ? requestId : null };
  } catch {
    throw new ProviderError('image_result_unknown');
  }
}
