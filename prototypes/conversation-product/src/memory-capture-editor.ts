import type { MemoryCaptureRequest as CaptureRequest } from '../../application-contract/personal-memory.ts';

export type MemoryCaptureRequest = CaptureRequest;

interface EditorOptions {
  conversationId: string;
  messageId: string;
  content: string;
  projectAvailable: boolean;
  review(request: CaptureRequest): Promise<boolean>;
  report(message: string): void;
  returnFocus?(): void;
}

/** Called only after the user chooses Remember message. Keep a single verbatim statement. */
function explicitMemoryCandidate(content: string): { text: string; category?: 'preferences' } | undefined {
  // Leave formatted examples and ambiguous multi-statement messages to manual editing.
  if (/(?:`{3,}|~{3,})/u.test(content)) return;
  const marked = content.split(/\r?\n/u).flatMap(line => {
    const match = /^Remember:[ \t]+(\S.*)$/iu.exec(line);
    return match ? [match[1].trimEnd()] : [];
  });
  if (marked.length === 1) return { text: marked[0] };
  if (marked.length) return;
  const statement = content.trim();
  if (/^I prefer [^.\n\r?!]+\.?$/iu.test(statement) &&
      !/\b(?:might|maybe|probably|if|unless|today|currently|for now)\b/iu.test(statement))
    return { text: statement, category: 'preferences' };
}

export function createMemoryCaptureEditor(options: EditorOptions): HTMLFormElement {
  const candidate = explicitMemoryCandidate(options.content);
  const form = document.createElement('form');
  form.className = 'cp-memory-editor';
  form.setAttribute('aria-label', 'Remember message');
  const field = (name: string, input: HTMLElement) => {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = name;
    label.className = 'cp-field';
    label.append(title, input);
    form.append(label);
  };
  const select = (name: string, choices: readonly (readonly [string, string])[]) => {
    const input = document.createElement('select');
    for (const [value, label] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      input.append(option);
    }
    input.value = choices[0][0];
    field(name, input);
    return input;
  };
  const text = document.createElement('textarea');
  text.value = candidate?.text ?? options.content;
  text.maxLength = 4096;
  text.rows = 3;
  text.required = true;
  field('Memory', text);
  const scope = select('Scope', options.projectAvailable
    ? [['conversation', 'This conversation'], ['project', 'This project']]
    : [['conversation', 'This conversation'], ['assistant.ordinary', 'All ordinary chats (preferences only)'],
      ['assistant.vela', 'All Vela chats (preferences only)']]);
  const category = select('Category', [['technical', 'Technical fact'], ['decisions', 'Decision'],
    ['preferences', 'Preference'], ['projects', 'Project detail']]);
  if (candidate?.category) category.value = candidate.category;
  const keywords = document.createElement('input');
  keywords.value = [...new Set(text.value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{2,64}/gu) ?? [])].filter(term => term !== 'prefer').slice(0, 8).join(', ');
  keywords.maxLength = 1056;
  keywords.required = true;
  field('Search terms, separated by commas', keywords);
  const review = document.createElement('button');
  review.type = 'submit';
  review.textContent = 'Review memory';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  form.append(review, cancel);
  const close = () => { form.remove(); options.returnFocus?.(); };
  cancel.addEventListener('click', close);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (review.disabled) return;
    if ((scope.value === 'assistant.ordinary' || scope.value === 'assistant.vela') && category.value !== 'preferences') {
      options.report('Choose Preference to save a memory across chats.');
      return;
    }
    const terms = [...new Set(keywords.value.split(',').map(term => term.trim()).filter(Boolean))];
    if (!text.value.trim() || text.value.length > 4096 || !terms.length || terms.length > 16 || terms.some(term => term.length > 64)) {
      options.report('Enter a memory and up to 16 search terms of 64 characters each.');
      return;
    }
    review.disabled = cancel.disabled = true;
    const request: CaptureRequest = {
      conversationId: options.conversationId, messageId: options.messageId,
      text: text.value, keywords: terms, scope: scope.value as CaptureRequest['scope'],
      category: category.value as CaptureRequest['category'],
    };
    void options.review(request).then(saved => {
      if (saved) { options.report('Memory saved'); close(); }
    }, error => {
      const message = error instanceof Error ? error.message : 'Memory review could not open.';
      options.report(message === 'stale_personal_memory_source'
        ? 'The original message or its project changed. Open Remember message again to review the current source.'
        : message);
    }).finally(() => {
      review.disabled = cancel.disabled = false;
    });
  });
  return form;
}
