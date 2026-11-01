import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, createEvents, createFilaments, createMessages, createParticles, FIXTURE_COUNTS } from '../src/fixtures.ts';

test('fixture identities, counts, and deterministic replay', () => {
  const messages = createMessages(), events = createEvents();
  assert.equal(messages.length, FIXTURE_COUNTS.messages);
  assert.equal(events.length, FIXTURE_COUNTS.events);
  assert.equal(blocks.length, FIXTURE_COUNTS.blocks);
  assert.equal(createParticles().length, FIXTURE_COUNTS.particles);
  assert.equal(createFilaments().length, FIXTURE_COUNTS.filaments);
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.equal(new Set(messages.map(message => message.id)).size, messages.length);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.deepEqual(createMessages(), messages);
  assert.deepEqual(createEvents(), events);
});

test('all simulated activity is labeled at source', () => {
  assert.ok(createEvents().every(event => event.detail.includes('Synthetic event')));
  assert.ok(createMessages().every(message => message.author === 'You' || message.author.includes('fixture')));
  assert.ok(blocks.every(block => block.detail.includes('synthetic') || block.detail.includes('simulated') || block.detail.includes('measurement')));
});
