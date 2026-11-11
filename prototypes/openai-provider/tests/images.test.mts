import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareImageGeneration, sendReviewedImageGeneration } from '../images.mts';

test('image generation dispatches exactly one reviewed request and accepts only inline bytes', async () => {
  const review = prepareImageGeneration('A geometric illustration');
  const signal = new AbortController().signal;
  let dispatches = 0;
  const fetchImage: typeof fetch = async (url, request) => {
    dispatches++;
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(request?.redirect, 'error');
    assert.equal(request?.body, review.body);
    return Response.json({ data: [{ b64_json: 'AQID' }] }, { headers: { 'x-request-id': 'req_image' } });
  };
  await assert.rejects(sendReviewedImageGeneration(review, '0'.repeat(64), 'test', signal, fetchImage), /image_review_changed/);
  assert.equal(dispatches, 0);
  const result = await sendReviewedImageGeneration(review, review.digest, 'test', signal, fetchImage);
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.requestId, 'req_image');
  assert.equal(dispatches, 1);
  await assert.rejects(sendReviewedImageGeneration(review, review.digest, 'test', signal,
    async () => Response.json({ data: [{ url: 'https://example.invalid/image.png' }] })), /image_result_unknown/);
});
