import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MEDIA_LIMITS } from '../application-contract/media.ts';
import { MediaError } from './media-policy.ts';

// A bundled local asset in Vite and a local package file in source tests.
// No CDN, remote PDF URL, browser fetch grant or eval is introduced.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;

export async function openPdf(bytes: Uint8Array, signal?: AbortSignal) {
  if (bytes.length > MEDIA_LIMITS.pdfBytes) throw new MediaError('too_large', 'PDF exceeds the inline byte limit.');
  const loading = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true,
    useWorkerFetch: false, useWasm: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true,
    maxImageSize: MEDIA_LIMITS.imagePixels, canvasMaxAreaInBytes: MEDIA_LIMITS.canvasPixels * 4 });
  let expired = false, disposed = false;
  const abort = () => { void loading.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { expired = true; abort(); }, MEDIA_LIMITS.parserTimeoutMs);
  let document: Awaited<typeof loading.promise>;
  try {
    signal?.throwIfAborted(); document = await loading.promise;
    if (document.numPages > MEDIA_LIMITS.pdfPages) {
      await loading.destroy(); throw new MediaError('too_large', 'This PDF exceeds the inline page limit.');
    }
  } catch (error) {
    await loading.destroy().catch(() => {});
    if (signal?.aborted) throw signal.reason;
    if (error instanceof MediaError) throw error;
    throw new MediaError(expired ? 'timeout' : 'invalid_data', expired ? 'PDF parsing exceeded its time limit.' : 'The PDF could not be parsed. Encrypted or damaged documents may require an external viewer.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  let render: pdfjs.RenderTask | undefined, textLayer: pdfjs.TextLayer | undefined, sequence = 0;
  const deadline = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { disposed = true; void loading.destroy().catch(() => {}); reject(new MediaError('timeout', 'PDF processing exceeded its time limit. Refresh or open the original externally.')); }, MEDIA_LIMITS.parserTimeoutMs);
    })]); } finally { clearTimeout(timer); }
  };
  const page = (number: number) => {
    if (disposed || !Number.isInteger(number) || number < 1 || number > document.numPages) throw new MediaError('invalid_data', 'Invalid PDF page.');
    return deadline(document.getPage(number));
  };
  return {
    pageCount: document.numPages,
    async text(number: number): Promise<string> {
      const content = await deadline((await page(number)).getTextContent());
      const text = content.items.map(item => 'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '').join('');
      if (text.length > 500000) throw new MediaError('too_large', 'This page exceeds the inline text limit.');
      return text;
    },
    async render(number: number, canvas: HTMLCanvasElement, container: HTMLElement | null, scale: number) {
      const current = ++sequence;
      render?.cancel(); textLayer?.cancel();
      const source = await page(number), base = source.getViewport({ scale: 1 });
      if (disposed || current !== sequence) return;
      if (![base.width, base.height, base.width * base.height].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(scale)) throw new MediaError('invalid_data', 'Invalid PDF page dimensions or zoom.');
      let bounded = Math.min(Math.max(0.25, Math.min(3, scale)), Math.sqrt(MEDIA_LIMITS.canvasPixels / (base.width * base.height)), 4096 / Math.max(base.width, base.height));
      let viewport = source.getViewport({ scale: bounded });
      while (Math.ceil(viewport.width) * Math.ceil(viewport.height) > MEDIA_LIMITS.canvasPixels) {
        bounded *= 0.999; viewport = source.getViewport({ scale: bounded });
      }
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new MediaError('unsupported', 'A PDF canvas is unavailable.');
      const task = render = source.render({ canvas, canvasContext: context, viewport });
      let expired = false;
      const timer = setTimeout(() => { expired = true; task.cancel(); }, MEDIA_LIMITS.parserTimeoutMs);
      try { await task.promise; }
      catch (error) { if (expired) throw new MediaError('timeout', 'PDF rendering exceeded its time limit.'); throw error; }
      finally { clearTimeout(timer); }
      if (disposed || current !== sequence) return;
      if (container) {
        container.replaceChildren(); container.style.width = viewport.width + 'px'; container.style.height = viewport.height + 'px';
        container.style.setProperty('--total-scale-factor', String(viewport.scale));
        const content = await deadline(source.getTextContent());
        if (content.items.length > 20000 || content.items.reduce((sum, item) => sum + ('str' in item ? item.str.length : 0), 0) > 500000) throw new MediaError('too_large', 'This page exceeds the selectable text limit.');
        textLayer = new pdfjs.TextLayer({ textContentSource: content, container, viewport });
        await deadline(textLayer.render());
      }
      return { width: viewport.width, height: viewport.height, scale: bounded };
    },
    cancel() { sequence++; render?.cancel(); textLayer?.cancel(); },
    async dispose() {
      if (disposed) return; disposed = true; render?.cancel(); textLayer?.cancel(); await loading.destroy();
    },
  };
}

export type PdfDocument = Awaited<ReturnType<typeof openPdf>>;
