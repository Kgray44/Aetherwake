import type { PersonalPolicy, RecordRef, ReviewedFact } from '../../../personal-context/src/contracts.ts';

type Page = { records: (RecordRef & { state: string })[]; next: string | null; policy: PersonalPolicy };
type Command = (input: unknown) => Promise<unknown>;

export function createPersonalMemoryView(command: Command): HTMLElement {
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
  async function load(after: string | null) {
    const intent = ++selection;
    const page = await command({ type: 'list', after }) as Page;
    if (intent !== selection) return;
    detail.replaceChildren();
    if (after === null) list.replaceChildren();
    policy.textContent = 'ChatGPT memory: ' + (page.policy.ordinaryEnabled ? 'Enabled for reviewed sends' : 'Off')
      + ' · Vela memory: ' + (page.policy.velaEnabled ? 'Enabled' : 'Off');
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
  async function inspect(record: Page['records'][number]) {
    const intent = ++selection;
    detail.replaceChildren();
    const controls = document.createElement('div');
    const manage = (action: 'revoke' | 'delete' | 'export') => button({
      revoke: 'Revoke', delete: 'Delete', export: 'Export',
    }[action], async () => {
      const result = await command({ type: 'manage', action, id: record.id, version: record.version }) as { status: string };
      if (result.status === 'applied') { await load(null); status.textContent = 'Memory updated'; }
      if (result.status === 'exported') status.textContent = 'Memory exported';
    });
    detail.append(controls);
    if (record.state === 'active') controls.append(manage('revoke'));
    controls.append(manage('delete'));
    const fact = await command({ type: 'read', id: record.id }) as ReviewedFact;
    if (intent !== selection) return;
    const body = document.createElement('p');
    body.textContent = fact.text;
    const source = document.createElement('p');
    source.textContent = fact.provenance.kind === 'conversation-message'
      ? `Source message ${fact.provenance.messageId} · conversation ${fact.provenance.conversationId}`
      : fact.provenance.kind === 'import' ? `Imported source ${fact.provenance.id}` : 'User statement';
    detail.append(body, source, manage('export'));
    if (record.state === 'active') {
      const editor = document.createElement('textarea');
      editor.setAttribute('aria-label', 'Corrected memory');
      editor.maxLength = 4096;
      editor.value = fact.text;
      const correction = button('Review correction', async () => {
        if (!editor.value.trim() || editor.value.length > 4096) throw Error('Enter a corrected memory.');
        const result = await command({ type: 'manage', action: 'correct', id: record.id, version: record.version, text: editor.value }) as { status: string };
        if (result.status === 'applied') { await load(null); status.textContent = 'Memory corrected'; }
      });
      detail.append(editor, correction);
    }
  }
  const more = button('More memories', async () => { if (next !== null) await load(next); });
  more.hidden = true;
  section.append(button('Load saved memories', () => load(null)), policy, status, list, more, detail);
  return section;
}
