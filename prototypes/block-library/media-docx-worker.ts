import { parseDocx } from './media-docx-parser.ts';
const worker = globalThis as unknown as { onmessage: (event: MessageEvent<Uint8Array>) => void; postMessage(value: unknown): void };
worker.onmessage = event => {
  void parseDocx(event.data).then(value => worker.postMessage({ ok: true, value }), error => worker.postMessage({ ok: false,
    code: error?.code ?? 'invalid_data', message: 'The Word document could not be read safely. The original is unchanged.' }));
};
