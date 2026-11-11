import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalRetrievalQuery, rankCanonicalRetrieval } from '../src/history-retrieval.mts';

interface Phase {
  provider: 'fixture-a' | 'fixture-b';
  allowed: string[];
  expected: string[];
}

interface HoldoutCase {
  id: string;
  category: string;
  query: string;
  sources: { id: string; text: string; version: number }[];
  before: Phase;
  after?: Phase;
}

export interface HoldoutSource {
  readonly sourceId: string;
  readonly sourceKind: 'note';
  readonly revision: string;
  readonly text: string;
}

export interface HoldoutOwner {
  readonly provider: Phase['provider'];
  search(query: string): { sources: readonly HoldoutSource[]; scan: 'bounded' };
  recent(): { sources: readonly HoldoutSource[]; scan: 'bounded' };
  isCurrent(source: HoldoutSource): boolean;
}

export type HoldoutRetriever = (query: string, owner: HoldoutOwner) =>
  readonly HoldoutSource[] | Promise<readonly HoldoutSource[]>;

const lexical: HoldoutRetriever = (query, owner) => owner.search(query).sources;
const fixture = new URL('./fixtures/cie-retrieval-holdout.json', import.meta.url);

export async function evaluateHoldout(retrieve: HoldoutRetriever = lexical) {
  const corpus: { contract: string; cases: HoldoutCase[] } = JSON.parse(await readFile(fixture, 'utf8'));
  assert.equal(corpus.contract, 'aerynth.cie-holdout@1');
  assert.equal(new Set(corpus.cases.map(entry => entry.id)).size, corpus.cases.length);
  const rows = [];

  for (const entry of corpus.cases) {
    const sourceIds = new Set(entry.sources.map(source => source.id));
    assert.equal(sourceIds.size, entry.sources.length, entry.id);
    let previous: readonly HoldoutSource[] = [];
    for (const [name, phase] of [['before', entry.before], ['after', entry.after]] as const) {
      if (!phase) continue;
      assert.ok(phase.allowed.every(id => sourceIds.has(id)), entry.id);
      assert.ok(phase.expected.every(id => phase.allowed.includes(id)), entry.id);
      assert.equal(new Set(phase.expected).size, phase.expected.length, entry.id);

      // Only the current owner projection supplies text. Fresh objects bind results to this phase.
      const authorized = entry.sources.filter(source => phase.allowed.includes(source.id)).map(source =>
        Object.freeze({ sourceId: source.id, sourceKind: 'note' as const, revision: String(source.version), text: source.text }));
      const candidates = authorized.map(source => ({ id: source.sourceId, text: source.text }));
      const byId = new Map(authorized.map(source => [source.sourceId, source]));
      const issued = new Set<HoldoutSource>();
      let active = true;
      const issue = (sources: readonly HoldoutSource[]) => {
        for (const source of sources) issued.add(source);
        return { sources: Object.freeze([...sources]), scan: 'bounded' as const };
      };
      const owner: HoldoutOwner = Object.freeze({
        provider: phase.provider,
        search(query: string) {
          if (!active) return issue([]);
          const parsed = canonicalRetrievalQuery(query);
          const ids = parsed ? rankCanonicalRetrieval(parsed, candidates).ids : [];
          return issue(ids.map(id => byId.get(id)!));
        },
        recent() {
          return issue(active ? authorized : []);
        },
        isCurrent(source: HoldoutSource) {
          return active && issued.has(source);
        },
      });

      const started = performance.now();
      let returned: readonly HoldoutSource[];
      try {
        returned = await retrieve(entry.query, owner);
      } finally {
        active = false;
      }
      const elapsedMs = performance.now() - started;
      const current = [...new Set(returned.filter(source => issued.has(source)))];
      const ids = current.map(source => source.sourceId);
      rows.push({
        case: entry.id, category: entry.category, phase: name, provider: phase.provider,
        expected: phase.expected, returned: ids,
        matched: phase.expected.filter(id => ids.includes(id)).length,
        missed: phase.expected.filter(id => !ids.includes(id)),
        unexpected: ids.filter(id => !phase.expected.includes(id)),
        invalidReturns: returned.filter(source => !issued.has(source)).length,
        previousBindingsRejected: previous.filter(source => !issued.has(source)).length,
        elapsedMs,
      });
      previous = current;
    }
  }

  return {
    contract: corpus.contract,
    cases: corpus.cases.length,
    phases: rows.length,
    matched: rows.reduce((total, row) => total + row.matched, 0),
    expected: rows.reduce((total, row) => total + row.expected.length, 0),
    unexpected: rows.reduce((total, row) => total + row.unexpected.length, 0),
    invalidReturns: rows.reduce((total, row) => total + row.invalidReturns, 0),
    rows,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--adapter'),
    'Usage: node tests/cie-retrieval-holdout.mts [--adapter ./path/to/adapter.mts]');
  const retrieve = args[1] ? (await import(pathToFileURL(resolve(args[1])).href)).retrieve : lexical;
  assert.equal(typeof retrieve, 'function', 'Adapter must export retrieve(query, owner)');
  const report = await evaluateHoldout(retrieve);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.invalidReturns > 0) process.exitCode = 1;
}
