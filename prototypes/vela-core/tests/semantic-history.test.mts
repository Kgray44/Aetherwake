import assert from 'node:assert/strict';
import test from 'node:test';
import { investigateSemanticHistory, maxSemanticAssessmentBytes } from '../src/semantic-history.mts';

const request = 'Which safeguard stopped the batch from being applied twice?';
const evidence = { key: 's1', question: 'What was the duplication safeguard?', query: 'duplicate operation' };
const proposal = { version: 1, objective: 'Find the previously chosen safeguard', clarification: '', needs: [evidence] };
const answer = { version: 1, assessment: [{ key: 's1', status: 'supported', sources: ['e1'], query: '' }] };
const candidate = { sourceId: 'conversation:message', revision: '4', text: 'The idempotency key prevents a second write.' };

test('refines a paraphrase, returns current source evidence and never treats model IDs as authority', async () => {
  const searches: string[] = [];
  const result = await investigateSemanticHistory(request, {
    search: query => { searches.push(query); return { sources: query === 'idempotency key' ? [candidate] : [], scan: 'bounded' }; },
    isCurrent: source => source === candidate,
    disclose: async call => call.stage === 'interpret' ? proposal : searches.length === 1
      ? { version: 1, assessment: [{ key: 's1', status: 'missing', sources: [], query: 'idempotency key' }] }
      : answer,
  });
  assert.deepEqual(searches, ['duplicate operation', 'idempotency key']);
  assert.equal(result.state, 'assessed');
  assert.deepEqual(result.coverage, [{ key: 's1', status: 'supported', sources: [candidate] }]);
});

test('disclosure denial preserves the native fallback and skips model-proposed reads', async () => {
  const result = await investigateSemanticHistory(request, {
    search: () => assert.fail('denied interpretation must not search'),
    isCurrent: () => false,
    disclose: async () => null,
  });
  assert.equal(result.state, 'unavailable');
  assert.deepEqual(result.coverage, []);
});

test('widens bounded candidate admission for six distinct needs and reserves gap capacity', async () => {
  const needs = Array.from({ length: 6 }, (_, index) => ({ key: 'need' + index, question: 'Find topic ' + index, query: 'topic' + index }));
  const source = (text: string) => ({ sourceId: text, revision: '1', text });
  const gap = source('resolved gap');
  const result = await investigateSemanticHistory(request, {
    adaptiveDiscovery: true,
    search: query => ({ sources: query === 'resolved gap' ? [gap] : [source(query + ' alpha'), source(query + ' beta')], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return { ...proposal, needs };
      for (const need of needs) assert.equal(call.excerpts.filter(excerpt => excerpt.text.startsWith(need.query)).length, 2);
      return { version: 1, assessment: needs.map((need, index) => {
        const found = call.excerpts.find(excerpt => excerpt.text === (index === 0 ? gap.text : need.query + ' alpha'));
        return { key: need.key, status: found ? 'supported' : 'missing', sources: found ? [found.handle] : [], query: found ? '' : 'resolved gap' };
      }) };
    },
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.coverage[0].sources, [gap]);
});

test('revisits a truncated discovery query when an incomplete need has no better query', async () => {
  const distractor = { ...candidate, sourceId: 'distractor', text: 'The duplicate operation alarm was reset.' };
  let widened = 0;
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [distractor], scan: 'partial', moreMatches: true }),
    widen: query => {
      assert.equal(query, evidence.query);
      widened++;
      return { sources: [candidate], scan: 'bounded' };
    },
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      return call.round === 1
        ? { version: 1, assessment: [{ key: 's1', status: 'missing', sources: [], query: '' }] }
        : { version: 1, assessment: [{ key: 's1', status: 'supported', sources: ['e2'], query: '' }] };
    },
  });
  assert.equal(widened, 1);
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('retrieves reviewed references from a cited partial match within the follow-up round', async () => {
  const anchor = { ...candidate, sourceId: 'anchor', text: 'See the equipment handoff.' };
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [anchor], scan: 'bounded' }),
    related: sources => {
      assert.deepEqual(sources, [anchor]);
      return { sources: [candidate], scan: 'bounded' };
    },
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : { version: 1, assessment: [{
      key: 's1', status: call.round === 1 ? 'partial' : 'supported',
      sources: call.round === 1 ? ['e1'] : ['e1', 'e2'], query: '',
    }] },
  });
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.coverage[0].sources, [anchor, candidate]);
});

test('reviewed discovery can recover from a lossy search query using the evidence question', async () => {
  const need = { ...evidence, question: 'Which idempotency key was used?' };
  const searches: string[] = [];
  const result = await investigateSemanticHistory(request, {
    adaptiveDiscovery: true,
    search: query => {
      searches.push(query);
      return { sources: query === need.question ? [candidate] : [], scan: 'bounded' };
    },
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? { ...proposal, needs: [need] } : call.round === 1
      ? { version: 1, assessment: [{ key: 's1', status: 'missing', sources: [], query: '' }] }
      : answer,
  });
  assert.deepEqual(searches, [need.query, need.question]);
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('a novel model refinement takes precedence over another page of the original query', async () => {
  const initial = { ...candidate, sourceId: 'initial' };
  const result = await investigateSemanticHistory(request, {
    search: query => query === evidence.query
      ? { sources: [initial], scan: 'partial', moreMatches: true }
      : { sources: [candidate], scan: 'bounded' },
    widen: () => assert.fail('the original query is not widened when a refinement is available'),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : { version: 1, assessment: [{
      key: 's1', status: call.round === 1 ? 'missing' : 'supported',
      sources: call.round === 1 ? [] : ['e2'], query: call.round === 1 ? 'idempotency key' : '',
    }] },
  });
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('one need can refine while another missing need falls back to its original question', async () => {
  const second = { key: 'second', question: 'Which engineer signs the release?', query: 'approval workflow' };
  const approver = { ...candidate, sourceId: 'approver', text: 'The duty engineer signs the release.' };
  const initial = Array.from({ length: 6 }, (_, index) => ({ ...candidate, sourceId: 'initial-' + index }));
  const secondary = { ...candidate, sourceId: 'secondary' };
  const searched: string[] = [];
  const result = await investigateSemanticHistory(request, {
    adaptiveDiscovery: true,
    search(query) {
      searched.push(query);
      const sources = query === evidence.query ? initial : query === second.question ? [approver] :
        query === 'replacement key' ? [candidate, secondary] : [];
      return { sources, scan: 'bounded' };
    },
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? { ...proposal, needs: [evidence, second] } : {
      version: 1, assessment: [
        { key: evidence.key, status: call.round === 1 ? 'missing' : 'supported', sources: call.round === 1 ? [] : ['e7'], query: call.round === 1 ? 'replacement key' : '' },
        { key: second.key, status: call.round === 1 ? 'missing' : 'supported', sources: call.round === 1 ? [] : ['e8'], query: '' },
      ],
    },
  });
  assert.deepEqual(searched, [evidence.query, second.query, 'replacement key', second.question]);
  assert.deepEqual(result.coverage[1].sources, [approver]);
});

test('a refinement that returns only previously reviewed sources falls back to the next original page', async () => {
  const initial = { ...candidate, sourceId: 'initial', text: 'Earlier inspection planning.' };
  const result = await investigateSemanticHistory(request, {
    search: query => ({ sources: [initial], scan: 'bounded', moreMatches: query === evidence.query }),
    widen: query => {
      assert.equal(query, evidence.query);
      return { sources: [candidate], scan: 'bounded' };
    },
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : { version: 1, assessment: [{
      key: 's1', status: call.round === 1 ? 'missing' : 'supported',
      sources: call.round === 1 ? [] : ['e2'], query: call.round === 1 ? 'inspection action' : '',
    }] },
  });
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('the current correction gets a slot ahead of lower-ranked matches', async () => {
  const needs = [evidence, { key: 'second', question: 'What else?', query: 'other result' }];
  const recent = { ...candidate, sourceId: 'recent', text: 'Current correction supplies the missing fact.' };
  const sources = (prefix: string) => Array.from({ length: 3 }, (_, index) => ({ ...candidate, sourceId: prefix + index }));
  const result = await investigateSemanticHistory(request, {
    search: query => ({ sources: sources(query), scan: 'partial', moreMatches: true }),
    recent: () => ({ sources: [recent], scan: 'bounded' }),
    widen: () => ({ sources: sources('lower rank'), scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? { ...proposal, needs } : { version: 1, assessment: [
      { key: 's1', status: call.round === 1 ? 'missing' : 'supported', sources: call.round === 1 ? [] : ['e7'], query: '' },
      { key: 'second', status: 'supported', sources: ['e2'], query: '' },
    ] },
  });
  assert.deepEqual(result.coverage[0].sources, [recent]);
});

test('recent corrections take priority over secondary matches for a refinement', async () => {
  const initial = Array.from({ length: 6 }, (_, index) => ({ ...candidate, sourceId: 'initial-' + index }));
  const match = { ...candidate, sourceId: 'refinement' };
  const distractor = { ...candidate, sourceId: 'secondary' };
  const correction = { ...candidate, sourceId: 'correction', text: 'Correction: use the replacement key.' };
  const result = await investigateSemanticHistory(request, {
    adaptiveDiscovery: true,
    search: query => ({ sources: query === evidence.query ? initial : [match, distractor], scan: 'bounded' }),
    recent: () => ({ sources: [correction], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : { version: 1, assessment: [{
      key: 's1', status: call.round === 1 ? 'missing' : 'supported',
      sources: call.round === 1 ? [] : ['e7', 'e8'], query: call.round === 1 ? 'replacement key' : '',
    }] },
  });
  assert.deepEqual(result.coverage[0].sources, [match, correction]);
});

test('reserves serialized bytes for gap recovery when first-pass excerpts are large', async () => {
  const needs = Array.from({ length: 4 }, (_, index) => ({ key: 'topic' + index, question: 'Find topic ' + index, query: 'topic' + index }));
  const source = (id: string) => ({ sourceId: id, revision: '1', sourceKind: 'conversation-exchange' as const, text: id.padEnd(3800, 'x') });
  const gap = source('refined result');
  const result = await investigateSemanticHistory(request, {
    adaptiveDiscovery: true,
    search: query => ({ sources: query === 'refined search' ? [gap] : [source(query + 'a'), source(query + 'b')], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return { ...proposal, needs };
      return { version: 1, assessment: needs.map((need, index) => {
        const found = call.excerpts.find(excerpt => excerpt.text.startsWith(index === 0 ? gap.sourceId : need.query));
        return { key: need.key, status: found ? 'supported' : 'missing', sources: found ? [found.handle] : [], query: found ? '' : 'refined search' };
      }) };
    },
  });
  assert.deepEqual(result.coverage[0].sources.map(source => source.sourceId), [gap.sourceId]);
});

test('retains three explicit files that fit the provider payload but exceed the discovery budget', async () => {
  const files = Array.from({ length: 3 }, (_, index) => ({
    sourceId: 'file-' + index, sourceKind: 'file' as const, revision: '1', text: String(index).repeat(10_000),
  }));
  const result = await investigateSemanticHistory(request, {
    assessmentMetadataBytes: 100,
    selected: () => ({ sources: files, scan: 'bounded' }),
    search: () => ({ sources: [], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      assert.equal(call.excerpts.length, 3);
      return answer;
    },
  });
  assert.equal(result.state, 'assessed');
});

test('a high-volume search leaves room for other evidence needs and a follow-up', async () => {
  const second = { ...candidate, sourceId: 'second', text: 'The supervisor approved the release.' };
  const followup = { ...candidate, sourceId: 'followup', text: 'The release takes effect at noon.' };
  const first = Array.from({ length: 8 }, (_, index) => ({ ...candidate, sourceId: 'first-' + index }));
  const needs = [evidence, { key: 's2', question: 'Who approved the release and when does it take effect?', query: 'release approval' }];
  const result = await investigateSemanticHistory(request, {
    search: query => ({ sources: query === 'duplicate operation' ? first : query === 'release approval' ? [second] : [followup], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return { ...proposal, needs };
      const approval = call.excerpts.find(item => item.text === second.text);
      assert.ok(approval, 'The second need must get an evidence slot');
      const timing = call.excerpts.find(item => item.text === followup.text);
      return { version: 1, assessment: [
        { key: 's1', status: 'supported', sources: ['e1'], query: '' },
        { key: 's2', status: timing ? 'supported' : 'partial',
          sources: timing ? [approval.handle, timing.handle] : [approval.handle], query: timing ? '' : 'release effective time' },
      ] };
    },
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.rounds, 2);
  assert.deepEqual(result.coverage[1].sources, [second, followup]);
});

test('rejects an invented source reference and fences out in-flight corrections', async () => {
  for (const revoked of [false, true]) {
    let current = true;
    const result = await investigateSemanticHistory(request, {
      search: () => ({ sources: [candidate], scan: 'partial' }), isCurrent: () => current,
      disclose: async call => {
        if (call.stage === 'interpret') return proposal;
        current = !revoked;
        return revoked ? answer : { version: 1, assessment: [{ ...answer.assessment[0], sources: ['e99'] }] };
      },
    });
    assert.notEqual(result.state, 'assessed');
    assert.deepEqual(result.coverage, []);
  }
});

test('reports partial owner coverage and retains usable hits after an oversized result', async () => {
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [{ ...candidate, sourceId: 'oversized', text: 'x'.repeat(2049) }, candidate], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      assert.deepEqual(call.excerpts, [{ handle: 'e1', text: candidate.text }]);
      return answer;
    },
  });
  assert.equal(result.searchCoverage, 'partial');
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('reports a partial excerpt without discarding a fact it directly supports', async () => {
  const excerpt = { ...candidate, partial: true as const };
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [excerpt], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : answer,
  });
  assert.equal(result.searchCoverage, 'partial');
  assert.equal(result.coverage[0].status, 'supported');
  assert.deepEqual(result.coverage[0].sources, [excerpt]);
});

test('separates inferred intent, constraints and verification from the search proposal', async () => {
  const result = await investigateSemanticHistory('Put the handoff on paper and make sure the safety check is covered.', {
    search: () => assert.fail('the model reported no historical evidence need'),
    isCurrent: () => false,
    disclose: async () => ({ version: 2, objective: 'Draft a checked handoff', clarification: '', needs: [],
      perception: { kind: 'plan', explicitGoals: ['Document the handoff'], inferredGoals: ['Review coverage before delivery'],
        constraints: ['Include the safety check'], capabilityHints: ['document authoring'], deliverables: ['document'],
        verification: ['The safety check is present in the final document'] } }),
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.proposal?.version, 2);
  if (result.proposal?.version !== 2) assert.fail('expected v2 perception');
  assert.equal(result.proposal.perception.kind, 'plan');
  assert.deepEqual(result.proposal.perception.deliverables, ['document']);
  assert.equal(result.rounds, 0);
});

test('assesses bounded canonical anchors when proposed queries miss a paraphrase', async () => {
  let anchorReads = 0;
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [], scan: 'bounded' }),
    recent: () => { anchorReads++; return { sources: [candidate], scan: 'partial' }; },
    isCurrent: source => source === candidate,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      assert.deepEqual(call.excerpts, [{ handle: 'e1', text: candidate.text }]);
      return answer;
    },
  });
  assert.equal(anchorReads, 1);
  assert.equal(result.rounds, 1);
  assert.equal(result.searchCoverage, 'partial');
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('keeps a clarification proposed after current evidence leaves the referent unresolved', async () => {
  const alternative = { sourceId: 'conversation:other', revision: '4', text: 'The scheduler retries once after a read timeout.' };
  const result = await investigateSemanticHistory('Which one did we decide to repeat?', {
    search: () => ({ sources: [candidate, alternative], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : {
      version: 2, clarification: 'Do you mean the batch operation or the scheduler read?',
      assessment: [{ key: 's1', status: 'uncertain', sources: ['e1', 'e2'], query: '' }],
    },
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.clarification, 'Do you mean the batch operation or the scheduler read?');
  assert.deepEqual(result.coverage[0].sources, [candidate, alternative]);
});

test('checks scoped evidence before returning an intake clarification without evidence needs', async () => {
  const intent = 'Can I reopen it after the trial run?';
  const clarification = 'Which enclosure do you mean?';
  const source = { sourceId: 'handoff', revision: '4', text: 'The trial run used only the north enclosure. Reopen it after the temperature check.' };
  for (const mode of ['resolved', 'unresolved', 'absent', 'revoked'] as const) {
    const stages: string[] = [];
    let current = true;
    const result = await investigateSemanticHistory(intent, {
      search: () => ({ sources: [], scan: 'bounded' }),
      recent: () => ({ sources: mode === 'absent' ? [] : [source], scan: 'bounded' }),
      isCurrent: item => item === source && current,
      disclose: async (call, sources) => {
        stages.push(call.stage);
        if (call.stage === 'interpret') return { ...proposal, clarification, needs: [] };
        assert.deepEqual(sources, [source]);
        assert.equal(call.request, intent);
        assert.equal(call.proposedClarification, clarification);
        assert.equal(call.needs[0].question, clarification);
        if (mode === 'revoked') current = false;
        const supported = mode !== 'unresolved';
        return { version: 3, clarification: '', assessment: [{
          key: call.needs[0].key, status: supported ? 'supported' : 'uncertain',
          passages: supported ? [{ source: 'e1', quote: source.text }] : [], query: '',
        }] };
      },
    });
    assert.deepEqual(stages, mode === 'absent' ? ['interpret'] : ['interpret', 'assess']);
    assert.equal(result.state, mode === 'revoked' ? 'stale' : 'assessed');
    assert.equal(result.clarification, mode === 'unresolved' || mode === 'absent' ? clarification : undefined);
    assert.deepEqual(result.coverage.flatMap(need => need.sources), mode === 'resolved' ? [source] : []);
  }
});

test('selected notes preserve recent evidence after a conversation query miss', async () => {
  const note = { sourceId: 'selected', revision: '1', text: 'Inspect the equipment on Thursday.' };
  const correction = { sourceId: 'recent', revision: '2', text: 'Move the maintenance visit to Monday.' };
  const result = await investigateSemanticHistory('When should we inspect the equipment?', {
    selected: () => ({ sources: [note], scan: 'bounded' }),
    search: () => ({ sources: [], scan: 'bounded' }),
    recent: () => ({ sources: [correction], scan: 'partial' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return { version: 1, objective: 'Resolve inspection date', clarification: '',
        needs: [{ key: 'date', question: 'When is the inspection?', query: 'inspection equipment' }] };
      return { version: 1, assessment: [{ key: 'date', status: call.excerpts.length === 2 ? 'contradicted' : 'supported',
        sources: call.excerpts.map(excerpt => excerpt.handle), query: '' }] };
    },
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.coverage[0].status, 'contradicted');
  assert.deepEqual(result.coverage[0].sources, [note, correction]);
});

test('binds assessed passages to the original request and rejects invented quotations', async () => {
  for (const quote of [candidate.text, 'An invented approval']) {
    let assessed = false;
    const result = await investigateSemanticHistory(request, {
      search: () => ({ sources: [candidate], scan: 'bounded' }),
      isCurrent: () => true,
      disclose: async call => {
        if (call.stage === 'interpret') return proposal;
        assert.equal(call.request, request);
        assessed = true;
        return { version: 3, clarification: '', assessment: [
          { key: 's1', status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
        ] };
      },
    });
    assert.equal(assessed, true);
    if (quote === candidate.text) {
      assert.equal(result.state, 'assessed');
      assert.deepEqual(result.coverage[0].passages, [{ sourceId: candidate.sourceId, quote }]);
    } else {
      assert.equal(result.state, 'invalid');
      assert.equal(result.failure, 'assessment-passage');
      assert.deepEqual(result.coverage, []);
    }
  }
});

test('overlapping passages from one source cannot establish a cross-source contradiction', async () => {
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [candidate], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : {
      version: 3, clarification: '', assessment: [{ key: 's1', status: 'contradicted', query: '',
        passages: [{ source: 'e1', quote: 'idempotency key' }, { source: 'e1', quote: candidate.text }] }],
    },
  });
  assert.equal(result.state, 'invalid');
  assert.equal(result.failure, 'assessment-support');
});

test('a later assessment cannot erase an earlier sourced conflict by dropping a citation', async () => {
  const monday = { ...candidate, sourceId: 'monday', text: 'Inspection is Monday.' };
  const tuesday = { ...candidate, sourceId: 'tuesday', text: 'Inspection is Tuesday.' };
  const additional = { ...candidate, sourceId: 'additional', text: 'The inspection takes one hour.' };
  const corrected = { ...additional, text: 'Correction: the inspection is Tuesday. Monday was cancelled.' };
  for (const scenario of ['dropped-citation', 'previously-seen-source', 'new-correction'] as const) {
    const resolvingSource = scenario === 'new-correction' ? corrected : undefined;
    const result = await investigateSemanticHistory(request, {
      search: query => ({ sources: query === evidence.query
        ? [monday, tuesday, ...(scenario === 'previously-seen-source' ? [additional] : [])]
        : [resolvingSource ?? { ...additional, sourceId: 'later' }], scan: 'bounded' }),
      isCurrent: () => true,
      disclose: async call => {
        if (call.stage === 'interpret') return proposal;
        const first = call.round === 1;
        assert.deepEqual(call.priorDisputes, first ? undefined : [{ key: 's1', sources: ['e1', 'e2'],
          passages: [{ source: 'e1', start: 0, end: monday.text.length },
            { source: 'e2', start: 0, end: tuesday.text.length }] }]);
        return { version: 3, clarification: '', assessment: [{
          key: 's1', status: first ? 'contradicted' : 'supported', query: first ? 'inspection correction' : '',
          passages: first ? [{ source: 'e1', quote: monday.text }, { source: 'e2', quote: tuesday.text }]
            : resolvingSource ? [{ source: 'e3', quote: resolvingSource.text }]
            : scenario === 'previously-seen-source' ? [{ source: 'e3', quote: additional.text }] : [{ source: 'e2', quote: tuesday.text }],
        }] };
      },
    });
    assert.equal(result.rounds, 2);
    assert.equal(result.coverage[0].status, resolvingSource ? 'supported' : 'contradicted');
    assert.deepEqual(result.coverage[0].sources, resolvingSource ? [corrected] : [monday, tuesday]);
  }
});

test('an unresolved follow-up retains earlier conflicting passages alongside new evidence', async () => {
  const accounts = ['Inspection is Monday.', 'Inspection is Tuesday.', 'Inspection is Wednesday.']
    .map((text, index) => ({ ...candidate, sourceId: String(index), text }));
  const result = await investigateSemanticHistory(request, {
    search: query => ({ sources: query === evidence.query ? accounts.slice(0, 2) : accounts.slice(2), scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      const cited = call.round === 1 ? [0, 1] : [1, 2];
      return { version: 3, clarification: '', assessment: [{
        key: 's1', status: 'contradicted', query: call.round === 1 ? 'inspection correction' : '',
        passages: cited.map(index => ({ source: 'e' + (index + 1), quote: accounts[index].text })),
      }] };
    },
  });
  assert.equal(result.coverage[0].status, 'contradicted');
  assert.deepEqual(result.coverage[0].passages, accounts.map(({ sourceId, text }) => ({ sourceId, quote: text })));
});

test('dispute pointers yield to newly retrieved evidence when the follow-up payload is full', async () => {
  const accounts = ['Inspection is Monday.', 'Inspection is Tuesday.', 'Correction: the inspection is Wednesday.']
    .map((text, index) => ({ ...candidate, sourceId: String(index), text }));
  let firstPayloadBytes = 0;
  const metadataBytes = 32_360;
  const result = await investigateSemanticHistory(request, {
    assessmentMetadataBytes: metadataBytes,
    search: query => ({ sources: query === evidence.query ? accounts.slice(0, 2) : accounts.slice(2), scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      const bytes = Buffer.byteLength(JSON.stringify(call));
      assert.ok(bytes + metadataBytes <= maxSemanticAssessmentBytes);
      if (call.round === 1) {
        firstPayloadBytes = bytes;
        return { version: 3, clarification: '', assessment: [{ key: 's1', status: 'contradicted', query: 'inspection correction',
          passages: accounts.slice(0, 2).map((source, index) => ({ source: 'e' + (index + 1), quote: source.text })) }] };
      }
      assert.ok(bytes > firstPayloadBytes);
      assert.equal(call.excerpts[2].text, accounts[2].text);
      return { version: 3, clarification: '', assessment: [{ key: 's1', status: 'supported', query: '',
        passages: [{ source: 'e3', quote: accounts[2].text }] }] };
    },
  });
  assert.equal(result.coverage[0].status, 'supported');
  assert.deepEqual(result.coverage[0].sources, accounts.slice(2));
});

test('the contradiction passage limit preserves distinct accounts before additional quotes', async () => {
  const quotes = Array.from({ length: 7 }, (_, index) => 'Monday account ' + index + '.');
  const accounts = [quotes.join(' '), 'Inspection is Tuesday.', 'Inspection is Wednesday.']
    .map((text, index) => ({ ...candidate, sourceId: String(index), text }));
  const result = await investigateSemanticHistory(request, {
    search: query => ({ sources: query === evidence.query ? accounts.slice(0, 2) : accounts.slice(2), scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      return { version: 3, clarification: '', assessment: [{
        key: 's1', status: 'contradicted', query: call.round === 1 ? 'inspection correction' : '',
        passages: call.round === 1
          ? [...quotes.map(quote => ({ source: 'e1', quote })), { source: 'e2', quote: accounts[1].text }]
          : [{ source: 'e2', quote: accounts[1].text }, { source: 'e3', quote: accounts[2].text }],
      }] };
    },
  });
  assert.deepEqual(result.coverage[0].sources, accounts);
  assert.equal(result.coverage[0].passages?.length, 8);
  assert.equal(result.searchCoverage, 'partial');
});

test('distinguishes cancelling a reviewed assessment from an invalid model response', async () => {
  const controller = new AbortController();
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [candidate], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      controller.abort();
      return null;
    },
  }, controller.signal);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.failure, 'cancelled');
  assert.deepEqual(result.coverage, []);
});

test('cancellation during synchronous discovery prevents further source reads and assessment', async () => {
  const controller = new AbortController();
  let searches = 0;
  let admissions = 0;
  let assessments = 0;
  const result = await investigateSemanticHistory(request, {
    search: () => {
      searches++;
      controller.abort();
      return { sources: [candidate], scan: 'bounded' };
    },
    recent: () => { searches++; return { sources: [], scan: 'bounded' }; },
    isCurrent: () => { admissions++; return true; },
    disclose: async call => {
      if (call.stage === 'interpret') return { ...proposal, needs: [evidence, { ...evidence, key: 's2', query: 'other source' }] };
      assessments++;
      return answer;
    },
  }, controller.signal);
  assert.equal(result.failure, 'cancelled');
  assert.equal(searches, 1);
  assert.equal(admissions, 0);
  assert.equal(assessments, 0);
});
