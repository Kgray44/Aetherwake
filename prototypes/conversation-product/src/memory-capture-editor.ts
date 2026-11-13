import type { MemoryCaptureRequest as CaptureRequest } from '../../application-contract/personal-memory.ts';
import { suggestMemoryFromMessage } from '../../vela-core/src/memory-candidate.ts';

export type MemoryCaptureRequest = CaptureRequest;

interface EditorOptions {
  conversationId: string;
  messageId: string;
  content: string;
  projectId: string | null;
  review(request: CaptureRequest): Promise<boolean>;
  report(message: string): void;
  returnFocus?(): void;
}

export function createMemoryCaptureEditor(options: EditorOptions): HTMLFormElement {
  const { content: expectedSourceText, projectId: expectedProjectId } = options;
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
  text.value = expectedSourceText;
  text.maxLength = 4096;
  text.rows = 3;
  text.required = true;
  field('Memory', text);
  const scope = select('Scope', expectedProjectId !== null
    ? [['conversation', 'This conversation'], ['project', 'This project']]
    : [['conversation', 'This conversation']]);
  const category = select('Category', [['technical', 'Technical fact'], ['decisions', 'Decision'],
    ['preferences', 'Preference'], ['projects', 'Project detail']]);
  const keywords = document.createElement('input');
  keywords.value = [...new Set(options.content.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{2,64}/gu) ?? [])].slice(0, 8).join(', ');
  keywords.maxLength = 1056;
  keywords.required = true;
  field('Search terms, separated by commas', keywords);
  const suggest = document.createElement('button');
  suggest.type = 'button';
  suggest.textContent = 'Suggest a memory';
  suggest.addEventListener('click', () => {
    const candidate = suggestMemoryFromMessage(options.content);
    if (!candidate) {
      options.report('No clear memory suggestion in this message.');
      return;
    }
    text.value = candidate.text;
    category.value = candidate.category;
    keywords.value = candidate.keywords.join(', ');
    text.focus();
  });
  const review = document.createElement('button');
  review.type = 'submit';
  review.textContent = 'Review memory';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  form.append(suggest, review, cancel);
  const close = () => { form.remove(); options.returnFocus?.(); };
  cancel.addEventListener('click', close);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (review.disabled) return;
    const terms = [...new Set(keywords.value.split(',').map(term => term.trim()).filter(Boolean))];
    if (!text.value.trim() || text.value.length > 4096 || !terms.length || terms.length > 16 || terms.some(term => term.length > 64)) {
      options.report('Enter a memory and up to 16 search terms of 64 characters each.');
      return;
    }
    review.disabled = cancel.disabled = suggest.disabled = true;
    const request: CaptureRequest = {
      conversationId: options.conversationId, messageId: options.messageId,
      expectedProjectId, expectedSourceText,
      text: text.value, keywords: terms, scope: scope.value as CaptureRequest['scope'],
      category: category.value as CaptureRequest['category'],
    };
    void options.review(request).then(saved => {
      if (saved) { options.report('Memory saved'); close(); }
    }, error => options.report(error instanceof Error ? error.message : 'Memory review could not open.')).finally(() => {
      review.disabled = cancel.disabled = suggest.disabled = false;
    });
  });
  return form;
}
