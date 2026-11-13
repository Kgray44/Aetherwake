import assert from 'node:assert/strict';
import test from 'node:test';
import { fuseCandidates } from './fuse-candidates.mts';

test('fusion keeps exact source references ahead of ranked alternatives', () => {
  assert.deepEqual(fuseCandidates(['lexical', 'shared', 'receipt:exact'],
    ['fulltext', 'shared'], ['receipt:exact']), ['receipt:exact', 'shared', 'lexical']);
});

test('fusion admits independent candidates and deduplicates each channel', () => {
  assert.deepEqual(fuseCandidates(['lexical', 'lexical', 'shared'],
    ['fulltext', 'shared'], []), ['shared', 'lexical', 'fulltext']);
  assert.deepEqual(fuseCandidates([], ['fulltext'], []), ['fulltext']);
  assert.deepEqual(fuseCandidates([], [], []), []);
});
