import type { NativeCredential } from './contracts.mts';
import { abortable, boundedJSON, credentialHeaders, digest, ProviderError, record, requireValue } from './common.mts';

export const missionImageModel = 'gpt-image-2.6-sunburst';
export const missionDraftImageModel = 'gpt-image-2.6-flare';
const imageQualities = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type MissionImageSettings = {
  model: typeof missionImageModel | typeof missionDraftImageModel;
  quality: (typeof imageQualities)[number];
};
export const missionImageRates = { textInput: 5, imageInput: 8, imageOutput: 30 };
export const missionImageSize = 1024;
export const missionImageMaxBytes = 8 * 1024 * 1024;
export type ImageDispatchReview = Readonly<{
  providerId: 'openai-api-vela';
  bodyDigest: string;
  credentialBoundaryDigest: string;
  organization: string | null;
  project: string | null;
}>;

export function missionImageSettings(options = ''): MissionImageSettings {
  const [mode = 'final', requestedQuality, extra] = options ? options.toLowerCase().split(/\s*,\s*/u) : [];
  const quality = imageQualities.find(value => value === (requestedQuality ?? (mode === 'draft' ? 'low' : 'medium')));
  requireValue((mode === 'final' || mode === 'draft') && extra === undefined && quality, 'invalid_image_settings');
  return { model: mode === 'draft' ? missionDraftImageModel : missionImageModel, quality };
}

export function prepareImageGeneration(prompt: string, settings = missionImageSettings()) {
  requireValue(typeof prompt === 'string' && prompt.trim() && Buffer.byteLength(prompt) <= 4096 &&
    !prompt.includes('\0'), 'invalid_image_prompt');
  const { model, quality } = settings;
  requireValue((model === missionImageModel || model === missionDraftImageModel) && imageQualities.includes(quality),
    'invalid_image_settings');
  const body = JSON.stringify({ model, prompt, n: 1,
    size: `${missionImageSize}x${missionImageSize}`, output_format: 'png', quality });
  return { body, digest: digest(body) };
}

function requestId(response: Response, credential: NativeCredential): string | null {
  try {
    const value = response.headers.get('x-request-id');
    if (!value || !/^req_[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
    if ([credential.bearer, credential.organization, credential.project, credential.boundaryDigest]
      .some(secret => typeof secret === 'string' && secret.length > 0 && value.includes(secret))) return null;
    return value;
  } catch { return null; }
}

/** Revalidates one account-bound review immediately before dispatching its admitted request. */
export async function sendReviewedImageGeneration(review: ReturnType<typeof prepareImageGeneration>, approvedDigest: string,
  credential: NativeCredential, revalidate: (review: ImageDispatchReview) => Promise<void>, signal: AbortSignal,
  fetchImage: typeof fetch = fetch) {
  requireValue(review.digest === approvedDigest && digest(review.body) === approvedDigest, 'image_review_changed');
  const boundCredential = structuredClone(credential);
  credentialHeaders(boundCredential, 'openai-api-vela', Date.now());
  const dispatchReview: ImageDispatchReview = Object.freeze({
    providerId: 'openai-api-vela', bodyDigest: approvedDigest,
    credentialBoundaryDigest: boundCredential.boundaryDigest,
    organization: boundCredential.organization ?? null, project: boundCredential.project ?? null,
  });
  requireValue(!signal.aborted, 'image_dispatch_unavailable');
  await abortable(revalidate(dispatchReview), signal);
  requireValue(review.digest === dispatchReview.bodyDigest && digest(review.body) === dispatchReview.bodyDigest &&
    !signal.aborted, 'image_review_changed');
  const headers = credentialHeaders(boundCredential, dispatchReview.providerId, Date.now());
  try {
    const response = await abortable(fetchImage('https://api.openai.com/v1/images/generations', {
      method: 'POST', redirect: 'error', signal, body: review.body,
      headers: { ...headers, 'Content-Type': 'application/json' },
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
    return { bytes, requestId: requestId(response, boundCredential) };
  } catch {
    throw new ProviderError('image_result_unknown');
  }
}
