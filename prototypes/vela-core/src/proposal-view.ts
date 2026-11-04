export interface VelaProposalChoice {
  id: string; version: number; question: string;
  items: readonly { id: string; label: string; detail?: string; kind?: string }[];
  acceptLabel?: string; declineLabel?: string;
}
/** Shared conversational choice surface. It presents an exact native proposal;
 * clicking a button delegates authority to the host's versioned action port. */
export function createVelaProposalView(doc: Document, actions: {
  accept(value: Readonly<VelaProposalChoice>): Promise<void>;
  decline(value: Readonly<VelaProposalChoice>): Promise<void>;
  changed?(): void;
}) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => { const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const element = el('section', 'vela-proposal'); element.setAttribute('aria-label', 'Vela proposal');
  const question = el('p', 'vela-proposal-question'), list = el('ul', 'vela-proposal-list'); list.setAttribute('aria-label', 'Proposed items');
  const more = el('button', 'vela-proposal-more'); more.type = 'button'; more.setAttribute('aria-expanded', 'false');
  const controls = el('div', 'vela-proposal-choices'), yes = el('button', 'vela-proposal-yes', 'Yes'), no = el('button', 'vela-proposal-no', 'No'); yes.type = no.type = 'button'; controls.append(yes, no);
  const error = el('p', 'vela-proposal-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  element.append(question, list, more, controls, error);
  let value: VelaProposalChoice | null = null, expanded = false, pending = false, disposed = false;
  const rows = new Map<string, HTMLLIElement>();
  function render() {
    if (!value) { element.hidden = true; return; } element.hidden = false;
    question.textContent = value.question; yes.textContent = value.acceptLabel || 'Yes'; no.textContent = value.declineLabel || 'No';
    const live = new Set(value.items.map(item => item.id)); for (const [id, row] of rows) if (!live.has(id)) { row.remove(); rows.delete(id); }
    value.items.forEach((item, index) => {
      let row = rows.get(item.id);
      if (!row) { row = el('li', 'vela-proposal-item'); row.append(el('span', 'vela-proposal-file-mark', '▤'), el('span', 'vela-proposal-item-copy')); rows.set(item.id, row); }
      const copy = row.children[1] as HTMLElement;
      const label = el('span', 'vela-proposal-item-name', item.label); label.title = item.label; copy.replaceChildren(label);
      if (item.detail) copy.append(el('span', 'vela-proposal-item-detail', item.detail));
      row.children[0].setAttribute('aria-hidden', 'true'); row.hidden = !expanded && index >= 4; list.append(row);
    });
    more.hidden = value.items.length <= 4; more.textContent = expanded ? 'Show less' : 'See all ' + value.items.length;
    more.setAttribute('aria-expanded', String(expanded)); yes.disabled = no.disabled = pending; element.setAttribute('aria-busy', String(pending));
  }
  more.addEventListener('click', () => { expanded = !expanded; render(); actions.changed?.(); });
  async function choose(accept: boolean) {
    if (pending || !value || disposed) return;
    const selected = value; pending = true; error.hidden = true; render();
    try { await (accept ? actions.accept(selected) : actions.decline(selected)); }
    catch { if (!disposed && value?.id === selected.id && value.version === selected.version) { error.textContent = 'This proposal needs checking again. Nothing else was approved.'; error.hidden = false; } }
    finally { pending = false; if (!disposed) { render(); actions.changed?.(); } }
  }
  yes.addEventListener('click', () => { void choose(true); }); no.addEventListener('click', () => { void choose(false); });
  render();
  return { element,
    update(next: VelaProposalChoice | null) {
      if (disposed) return;
      if (next && (!next.items.length || next.items.length > 256 || new Set(next.items.map(item => item.id)).size !== next.items.length)) throw Error('proposal_items_invalid');
      if (value?.id !== next?.id || value?.version !== next?.version) { expanded = false; error.hidden = true; }
      value = next ? Object.freeze({ ...next, items: next.items.map(item => Object.freeze({ ...item })) }) : null;
      if (!value) { rows.clear(); list.replaceChildren(); question.textContent = ''; error.textContent = ''; }
      render();
    },
    dispose() { disposed = true; rows.clear(); value = null; element.remove(); },
  };
}
