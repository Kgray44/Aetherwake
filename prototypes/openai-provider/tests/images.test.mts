import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareImageGeneration, sendReviewedImageGeneration, type ImageDispatchReview } from '../images.mts';
import type { NativeCredential } from '../contracts.mts';

const boundary = 'a'.repeat(64);
const scopedCredential = (): NativeCredential => ({ providerId: 'openai-api-vela', kind: 'openai-api-key',
  boundaryDigest: boundary, bearer: 'synthetic-image-api-key', organization: 'org-fixture', project: 'proj-fixture' });

test('only reviewed Image 2.6 models and supported quality settings form requests', () => {
  const final = prepareImageGeneration('A geometric illustration');
  const draft = prepareImageGeneration('A geometric illustration', { model: 'gpt-image-2.6-flare', quality: 'xhigh' });
  assert.deepEqual(JSON.parse(final.body), {
    model: 'gpt-image-2.6-sunburst', prompt: 'A geometric illustration', n: 1,
    size: '1024x1024', output_format: 'png', quality: 'medium',
  });
  assert.equal(JSON.parse(draft.body).model, 'gpt-image-2.6-flare');
  assert.equal(JSON.parse(draft.body).quality, 'xhigh');
  assert.notEqual(final.digest, draft.digest);
  assert.throws(() => prepareImageGeneration('A geometric illustration', {
    model: 'gpt-image-1.5', quality: 'low',
  } as never), /invalid_image_settings/);
});

test('image generation dispatches exactly one reviewed request and accepts only inline bytes', async () => {
  const review = prepareImageGeneration('A geometric illustration');
  const signal = new AbortController().signal;
  let dispatches = 0;
  let revalidations = 0;
  const fetchImage: typeof fetch = async (url, request) => {
    dispatches++;
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(request?.redirect, 'error');
    assert.equal(request?.body, review.body);
    const headers = new Headers(request?.headers);
    assert.equal(headers.get('authorization'), 'Bearer synthetic-image-api-key');
    assert.equal(headers.get('OpenAI-Organization'), 'org-fixture');
    assert.equal(headers.get('OpenAI-Project'), 'proj-fixture');
    return Response.json({ data: [{ b64_json: 'AQID' }] }, { headers: { 'x-request-id': 'req_image' } });
  };
  const revalidate = async (dispatchReview: ImageDispatchReview) => {
    revalidations++;
    assert.deepEqual(dispatchReview, { providerId: 'openai-api-vela', bodyDigest: review.digest,
      credentialBoundaryDigest: boundary, organization: 'org-fixture', project: 'proj-fixture' });
  };
  await assert.rejects(sendReviewedImageGeneration(review, '0'.repeat(64), scopedCredential(), revalidate, signal, fetchImage), /image_review_changed/);
  assert.equal(dispatches, 0);
  const result = await sendReviewedImageGeneration(review, review.digest, scopedCredential(), revalidate, signal, fetchImage);
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.requestId, 'req_image');
  assert.equal(dispatches, 1);
  assert.equal(revalidations, 1);
  await assert.rejects(sendReviewedImageGeneration(review, review.digest, scopedCredential(), revalidate, signal,
    async () => Response.json({ data: [{ url: 'https://example.invalid/image.png' }] })), /image_result_unknown/);
});

test('image generation omits absent account bindings and redacts reflected credential diagnostics', async () => {
  const review = prepareImageGeneration('A geometric illustration');
  const credential: NativeCredential = { providerId: 'openai-api-vela', kind: 'openai-api-key',
    boundaryDigest: boundary, bearer: 'synthetic-image-api-key' };
  const result = await sendReviewedImageGeneration(review, review.digest, credential, async dispatchReview => {
    assert.equal(dispatchReview.organization, null);
    assert.equal(dispatchReview.project, null);
  }, new AbortController().signal, async (_url, request) => {
    const headers = new Headers(request?.headers);
    assert.equal(headers.get('OpenAI-Organization'), null);
    assert.equal(headers.get('OpenAI-Project'), null);
    return Response.json({ data: [{ b64_json: 'AQID' }] }, { headers: { 'x-request-id': `req_${boundary}` } });
  });
  assert.equal(result.requestId, null);
});
