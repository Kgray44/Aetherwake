import type { PersonalPolicy, RecordRef, ReviewedFact } from '../../../personal-context/src/contracts.ts';

type Page = { records: (RecordRef & { state: ReviewedFact['state'] })[]; next: string | null; policy: PersonalPolicy };
type Command = (input: unknown) => Promise<unknown>;
const scopeLabels = {
  'assistant.ordinary': 'Ordinary chats', 'assistant.vela': 'Vela', 'user.shared': 'Shared by selection',
  project: 'This project', conversation: 'This conversation',
} as const;
const stateLabels = { active: 'Saved', revoked: 'Revoked', superseded: 'Superseded' } as const;
const certaintyLabels: Record<ReviewedFact['certainty'], string> = {
  'explicit-statement': 'Explicit statement', 'user-reviewed-summary': 'User-reviewed wording', 'user-preference': 'User preference', 'imported-summary': 'Imported summary',
  'historical-observation': 'Historical observation', inference: 'Inference', conflicting: 'Conflicting', unknown: 'Unknown',
};

type OpenSource = (source: { conversationId: string; messageId: string }) => Promise<void>;

export function createPersonalMemoryView(command: Command, openSource?: OpenSource): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Saved memories');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const policy = document.createElement('p');
  const list = document.createElement('ul');
  const detail = document.createElement('div');
  const button = (label: string, work: () => Promise<void>) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.addEventListener('click', () => {
      if (control.disabled) return;
      control.disabled = true;
      status.textContent = '';
      void work().catch(error => { status.textContent = error instanceof Error ? error.message : 'Memory unavailable'; })
        .finally(() => { control.disabled = false; });
    });
    return control;
  };
  let next: string | null = null;
  let selection = 0;
  let currentPolicy: PersonalPolicy | undefined;
  const disableMemory = (assistant: 'ordinary' | 'vela', name: string) => button(`Turn off ${name} memory`, async () => {
    if (!(assistant === 'ordinary' ? currentPolicy?.ordinaryEnabled : currentPolicy?.velaEnabled) || !currentPolicy) return;
    const version = currentPolicy.version;
    const updated = await command({ type: 'disableProviderMemory', assistant, version }) as PersonalPolicy;
    if (!currentPolicy || updated.version >= currentPolicy.version) renderPolicy(updated);
    status.textContent = `${name} memory is off. Your saved memories are still available here.`;
  });
  const disableChatGPT = disableMemory('ordinary', 'ChatGPT');
  const disableVela = disableMemory('vela', 'Vela');
  disableChatGPT.hidden = disableVela.hidden = true;
  function renderPolicy(value: PersonalPolicy) {
    currentPolicy = value;
    policy.textContent = 'ChatGPT memory: ' + (value.ordinaryEnabled ? 'Enabled for reviewed sends' : 'Off')
      + ' · Vela memory: ' + (value.velaEnabled ? 'Enabled for reviewed sends' : 'Off');
    disableChatGPT.hidden = !value.ordinaryEnabled;
    disableVela.hidden = !value.velaEnabled;
  }
  async function load(after: string | null) {
    const intent = ++selection;
    const page = await command({ type: 'list', after }) as Page;
    if (intent !== selection) return;
    detail.replaceChildren();
    if (after === null) list.replaceChildren();
    if (!currentPolicy || page.policy.version >= currentPolicy.version) renderPolicy(page.policy);
    for (const record of page.records) {
      const row = document.createElement('li');
      const scope = record.scope.kind === 'assistant.ordinary' ? 'All ordinary chats' : record.scope.kind;
      row.append(button(`Memory ${record.id} · ${scope} · ${record.state}`, () => inspect(record)));
      list.append(row);
    }
    next = page.next;
    more.hidden = next === null;
    if (!list.children.length) status.textContent = next ? 'No accessible memories on this page.' : 'No saved memories.';
  }
  async function inspect(record: Pick<RecordRef, 'id'> & Partial<Pick<RecordRef, 'version'>>) {
    const intent = ++selection;
    detail.replaceChildren();
    const controls = document.createElement('div');
    const manage = (target: Pick<RecordRef, 'id' | 'version'>, action: 'revoke' | 'delete' | 'export') => button({
      revoke: 'Revoke', delete: 'Delete', export: 'Export',
    }[action], async () => {
      const result = await command({ type: 'manage', action, id: target.id, version: target.version }) as { status: string };
      if (result.status === 'applied') { await load(null); status.textContent = 'Memory updated'; }
      if (result.status === 'exported') status.textContent = 'Memory exported';
    });
    let fact: ReviewedFact;
    try {
      fact = await command({ type: 'read', id: record.id }) as ReviewedFact;
    } catch (error) {
      if (intent !== selection) return;
      if (record.version !== undefined) detail.append(manage({ id: record.id, version: record.version }, 'delete'));
      throw error;
    }
    if (intent !== selection) return;
    detail.append(controls);
    if (fact.state === 'active') controls.append(manage(fact, 'revoke'));
    controls.append(manage(fact, 'delete'));
    const body = document.createElement('p');
    body.textContent = fact.text;
    const source = document.createElement('p');
    source.textContent = fact.provenance.kind === 'conversation-message'
      ? `Source message ${fact.provenance.messageId} · conversation ${fact.provenance.conversationId}`
      : fact.provenance.kind === 'import' ? `Imported source ${fact.provenance.id}` : 'User statement';
    const description = document.createElement('p');
    description.textContent = [stateLabels[fact.state], scopeLabels[fact.scope.kind], certaintyLabels[fact.certainty]]
      .filter(Boolean).join(' · ');
    const use = document.createElement('p');
    use.textContent = fact.state === 'active'
      ? 'Eligible for recall when the scope, request, and memory settings allow.'
      : 'Excluded from future recall.';
    detail.append(description, body, source, use, manage(fact, 'export'));
    const replacementId = fact.supersededBy;
    if (fact.state === 'superseded' && replacementId && replacementId !== fact.id) {
      detail.append(button('Open replacement memory', () => inspect({ id: replacementId })));
    }
    const origin = fact.provenance;
    if (openSource && origin.kind === 'conversation-message') {
      detail.append(button('Open original message', async () => {
        const latest = await command({ type: 'read', id: fact.id }) as ReviewedFact;
        if (intent !== selection) return;
        const current = latest.provenance;
        if (latest.version !== fact.version || current.kind !== 'conversation-message' ||
            current.conversationId !== origin.conversationId || current.messageId !== origin.messageId ||
            current.version !== origin.version || current.contentDigest !== origin.contentDigest)
          throw Error('Memory has changed. Reload saved memories to see its current source.');
        await openSource({ conversationId: origin.conversationId, messageId: origin.messageId });
      }));
    }
    if (origin.kind === 'conversation-message') {
      detail.append(button('Revoke original message', async () => {
        const result = await command({ type: 'revokeSource', id: fact.id, version: fact.version }) as { status: string };
        if (result.status === 'applied') {
          await load(null);
          status.textContent = 'Original message revoked and dependent memories removed.';
        }
      }));
    }
    if (fact.state === 'active') {
      const editor = document.createElement('textarea');
      editor.setAttribute('aria-label', 'Corrected memory');
      editor.maxLength = 4096;
      editor.value = fact.text;
      const searchTerms = document.createElement('input');
      const termsLabel = document.createElement('label');
      termsLabel.textContent = 'Search terms (comma separated)';
      termsLabel.append(searchTerms);
      searchTerms.maxLength = 1040;
      searchTerms.value = fact.keywords.join(', ');
      const correction = button('Review correction', async () => {
        if (!editor.value.trim() || editor.value.length > 4096) throw Error('Enter a corrected memory.');
        const keywords = searchTerms.value === fact.keywords.join(', ') ? undefined
          : [...new Set(searchTerms.value.split(',').map(term => term.trim()).filter(Boolean))];
        if (keywords && (!keywords.length || keywords.length > 16 || keywords.some(term => term.length > 64)))
          throw Error('Enter 1–16 search terms of up to 64 characters each.');
        const result = await command({ type: 'manage', action: 'correct', id: fact.id, version: fact.version,
          text: editor.value, ...(keywords ? { keywords } : {}) }) as { status: string };
        if (result.status === 'applied') { await load(null); status.textContent = 'Memory corrected'; }
      });
      detail.append(editor, termsLabel, correction);
    }
  }
  const more = button('More memories', async () => { if (next !== null) await load(next); });
  more.hidden = true;
  section.append(button('Load saved memories', () => load(null)), policy, disableChatGPT, disableVela, status, list, more, detail);
  return section;
}
