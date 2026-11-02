import type { Resource } from '../application-contract/contracts.ts';
import { MEDIA_LIMITS, type MediaCapabilities, type MediaMetadata, type MediaReadPort, type MediaPlaybackLease } from '../application-contract/media.ts';
import { assertMediaSignature, canonicalMediaUrl, imageDimensions, MediaError, readMediaBytes, validateMediaMetadata, validatePlaybackLease } from './media-policy.ts';
import { mountSafeDocument, highlightDocument } from './media-docx-dom.ts';
import type { PdfDocument } from './media-pdf.ts';

/** Structural canonical projection; it contains no file locator or placement.
 * Root's canonical resource kinds are the sole identity authority. */
export type MediaResource = Pick<Resource, 'id' | 'title' | 'version' | 'available' | 'visible' | 'state'> & { kind: 'file' | 'link' };
export type MediaExperience = { update(resource: MediaResource): void; setActive(active: boolean): void; flush(): Promise<void>; dispose(): void };
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const element = document.createElement(tag); element.className = cls; element.textContent = text; return element;
};
const available = (resource: MediaResource) => resource.available !== false && resource.visible !== false && resource.state !== 'archived';
const publicError = (error: unknown) => {
  if (error instanceof MediaError) return error.message;
  const code = (error as { code?: string })?.code;
  return ({ revoked: 'Access to this source was revoked.', permission_required: 'Permission is required to read the original source.',
    source_changed: 'The original source changed. Refresh to read its current revision.', unavailable: 'The original source is unavailable.',
    too_large: 'This source exceeds the inline viewer limit. Open the original externally when available.' } as Record<string, string>)[code ?? ''] ?? 'This source could not be displayed. Refresh or open the original when available.';
};
const byteLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;

/** Used unchanged in a workspace content slot and Root's direct focused slot.
 * No database, file picker, frame/material, navigation or layout writes. */
export function mountMediaExperience(root: HTMLElement, initial: MediaResource, port: MediaReadPort): MediaExperience {
  let resource = initial, active = true, disposed = false, generation = 0, loadedVersion = -1;
  let abort: AbortController | undefined, metadata: MediaMetadata | undefined, capabilities: MediaCapabilities | undefined;
  let pdf: PdfDocument | undefined, lease: MediaPlaybackLease | undefined, objectUrl: string | undefined;
  let resumePdf: (() => void) | undefined;
  let video: HTMLVideoElement | undefined, playbackButton: HTMLButtonElement | undefined;
  let playbackPending = false, playbackSequence = 0, pdfPage = 1, pdfScale = 1, drawSequence = 0;
  const title = node('h3', 'aw-media-title', resource.title), kind = node('span', 'aw-media-kind');
  const header = node('header', 'aw-media-heading'), information = node('p', 'aw-media-information');
  const tools = node('div', 'aw-media-tools'), body = node('section', 'aw-media-body'), status = node('p', 'aw-media-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  header.append(kind, title); root.classList.add('aw-media'); root.dataset.resourceId = initial.id;
  root.replaceChildren(header, information, tools, body, status);
  const valid = (token: number) => !disposed && active && available(resource) && token === generation;
  const request = () => ({ resourceId: resource.id, expectedVersion: resource.version, sourceRevision: metadata!.sourceRevision });
  const button = (label: string, work: () => void | Promise<void>) => {
    const value = node('button', 'aw-media-button', label); value.type = 'button'; value.onclick = () => {
      if (!active || disposed || !available(resource)) return;
      try { void Promise.resolve(work()).catch(error => { if (!disposed && active) status.textContent = publicError(error); }); }
      catch (error) { status.textContent = publicError(error); }
    }; return value;
  };
  const release = () => {
    playbackSequence++;
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); video = undefined; }
    body.querySelector('iframe')?.remove();
    if (lease) { const prior = lease; lease = undefined; void port.releasePlayback({ leaseId: prior.leaseId }).catch(() => {}); }
    playbackPending = false;
    if (playbackButton) { playbackButton.disabled = !active; playbackButton.hidden = false; }
  };
  const clear = () => {
    abort?.abort(); abort = undefined; drawSequence++; release();
    resumePdf = undefined;
    const prior = pdf; pdf = undefined; if (prior) void prior.dispose().catch(() => {});
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined;
  };
  const external = () => {
    if (capabilities?.openExternal) tools.append(button('Open original', async () => {
      await port.openExternal({ resourceId: resource.id, expectedVersion: resource.version });
    }));
  };
  const findField = (action: (query: string) => void | Promise<void>) => {
    const form = node('form', 'aw-media-find'), field = node('input'); field.type = 'search'; field.placeholder = 'Find in document'; field.maxLength = 200;
    field.setAttribute('aria-label', 'Find in document'); const submit = button('Find', () => action(field.value)); submit.type = 'submit'; submit.onclick = null;
    form.append(field, submit); form.onsubmit = event => { event.preventDefault(); if (active && !disposed) void Promise.resolve(action(field.value)).catch(error => { status.textContent = publicError(error); }); };
    tools.append(form); return field;
  };
  async function showPdf(bytes: Uint8Array, token: number) {
    const { openPdf } = await import('./media-pdf.ts'); if (!valid(token)) return;
    const document = await openPdf(bytes, abort?.signal); if (!valid(token)) { await document.dispose(); return; } pdf = document;
    const pagination = node('div', 'aw-media-pagination'), page = node('input'), count = node('span', '', `/ ${document.pageCount}`);
    page.type = 'number'; page.min = '1'; page.max = String(document.pageCount); page.value = String(pdfPage = Math.min(pdfPage, document.pageCount)); page.setAttribute('aria-label', 'PDF page');
    const frame = node('div', 'aw-media-pdf-page'), canvas = node('canvas'), text = node('div', 'aw-media-pdf-text textLayer'); frame.append(canvas, text); body.replaceChildren(frame);
    const previous = button('Previous page', () => move(pdfPage - 1)), next = button('Next page', () => move(pdfPage + 1));
    const zoom = node('select'); zoom.setAttribute('aria-label', 'PDF zoom');
    for (const value of [0.5, 0.75, 1, 1.25, 1.5, 2]) { const option = node('option', '', `${value * 100}%`); option.value = String(value); zoom.append(option); } zoom.value = String(pdfScale);
    let needsRedraw = false;
    const draw = async () => {
      needsRedraw = true;
      const sequence = ++drawSequence; previous.disabled = pdfPage <= 1; next.disabled = pdfPage >= document.pageCount; page.value = String(pdfPage);
      status.textContent = `Rendering page ${pdfPage}…`;
      try {
        await document.render(pdfPage, canvas, text, pdfScale);
        if (valid(token) && sequence === drawSequence) { needsRedraw = false; status.textContent = `Page ${pdfPage} of ${document.pageCount}. Select text directly on the page.`; }
      } catch (error) { if (valid(token) && sequence === drawSequence && (error as Error)?.name !== 'RenderingCancelledException') status.textContent = publicError(error); }
    };
    resumePdf = () => { if (needsRedraw) void draw(); };
    const move = async (number: number) => { if (!Number.isInteger(number) || number < 1 || number > document.pageCount) return; pdfPage = number; await draw(); };
    page.onchange = () => { void move(Number(page.value)); }; zoom.onchange = () => { pdfScale = Number(zoom.value); void draw(); };
    pagination.append(previous, page, count, next, zoom); tools.prepend(pagination);
    let searchSequence = 0;
    findField(async query => {
      const search = ++searchSequence, needle = query.trim().toLocaleLowerCase(); if (!needle) return;
      status.textContent = 'Finding text…'; const deadline = performance.now() + MEDIA_LIMITS.parserTimeoutMs;
      for (let index = 0; index < document.pageCount; index++) {
        if (!valid(token) || search !== searchSequence) return;
        if (performance.now() > deadline) { status.textContent = 'Search reached its time limit. Try a later page.'; return; }
        const number = (pdfPage - 1 + index) % document.pageCount + 1;
        if ((await document.text(number)).toLocaleLowerCase().includes(needle)) {
          if (!valid(token) || search !== searchSequence) return; await move(number);
          for (const span of text.querySelectorAll('span')) if (span.textContent?.toLocaleLowerCase().includes(needle)) span.classList.add('aw-media-match');
          if (valid(token)) status.textContent = `Match on page ${number}.`; return;
        }
      }
      if (valid(token) && search === searchSequence) status.textContent = 'No matching text found.';
    });
    await draw();
  }
  async function showPlayback(token: number) {
    if (!metadata || playbackPending || lease || !valid(token) || !(metadata.format === 'youtube' ? capabilities?.embed : capabilities?.play)) return;
    const attempt = ++playbackSequence;
    playbackPending = true; playbackButton!.disabled = true; status.textContent = 'Opening player…';
    let acquired: MediaPlaybackLease | undefined;
    try {
      acquired = await port.acquirePlayback({ ...request(), intent: metadata.format === 'youtube' ? 'youtube' : 'local-video' });
      validatePlaybackLease(acquired, metadata);
      if (!valid(token) || attempt !== playbackSequence) { await port.releasePlayback({ leaseId: acquired.leaseId }); return; }
      lease = acquired;
      if (acquired.kind === 'local-video') {
        video = node('video', 'aw-media-video'); video.controls = true; video.preload = 'metadata'; video.autoplay = false; video.playsInline = true;
        video.setAttribute('aria-label', metadata.name); video.src = acquired.src;
        video.onerror = () => { if (valid(token)) { status.textContent = 'This video codec could not be played here. Open the original when available.'; release(); } };
        body.replaceChildren(video);
      } else {
        const iframe = node('iframe', 'aw-media-youtube'); iframe.title = metadata.name; iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen'); iframe.allowFullscreen = true; iframe.src = acquired.src; body.replaceChildren(iframe);
      }
      playbackButton!.hidden = true; status.textContent = 'Use the player controls to start playback.';
    } catch (error) {
      if (acquired && lease !== acquired) await port.releasePlayback({ leaseId: acquired.leaseId }).catch(() => {});
      if (valid(token)) status.textContent = publicError(error);
    } finally { if (attempt === playbackSequence) { playbackPending = false; if (playbackButton && valid(token)) playbackButton.disabled = false; } }
  }
  async function load() {
    const token = ++generation; clear(); tools.replaceChildren(); body.replaceChildren(); metadata = undefined; capabilities = undefined; playbackButton = undefined;
    loadedVersion = -1;
    if (!active || !available(resource)) { status.textContent = 'This resource is unavailable.'; return; }
    abort = new AbortController(); status.textContent = 'Reading source information…';
    try {
      const description = await port.describe({ resourceId: resource.id }); if (!valid(token)) return;
      metadata = validateMediaMetadata(description.metadata); capabilities = description.capabilities;
      if (metadata.source !== resource.kind) throw new MediaError('invalid_data', 'The canonical resource and source type disagree.');
      root.dataset.mediaFormat = metadata.format; title.textContent = resource.title; kind.textContent = ({ pdf: 'PDF', docx: 'Document', video: 'Video', image: 'Image', text: 'Text file', binary: 'File', web: 'Web link', youtube: 'YouTube' })[metadata.format];
      information.textContent = metadata.name + ' · ' + metadata.mime + (metadata.source === 'file' ? ' · ' + byteLabel(metadata.byteLength) : '');
      external(); tools.append(button('Refresh source', load));
      if (metadata.source === 'link' && metadata.format === 'web') {
        const url = canonicalMediaUrl(metadata.url); body.append(node('p', 'aw-media-domain', url.hostname), node('p', 'aw-media-url', url.href));
        status.textContent = capabilities.openExternal ? 'Open this link in your browser.' : 'External opening is unavailable.';
      } else if (metadata.format === 'video' || metadata.format === 'youtube') {
        body.append(node('div', 'aw-media-screen', metadata.format === 'youtube' ? 'YouTube' : 'Video'));
        const enabled = metadata.format === 'youtube' ? capabilities.embed : capabilities.play;
        playbackButton = button('Open player', () => showPlayback(token)); playbackButton.disabled = !enabled; tools.prepend(playbackButton);
        status.textContent = enabled ? 'Playback starts only when you use the player controls.' : metadata.format === 'youtube'
          ? 'Inline YouTube playback is unavailable. Open the canonical link externally when available.' : 'Inline playback is unavailable. Open the original when available.';
      } else if (metadata.source === 'file' && metadata.format === 'binary') {
        body.append(node('dl', 'aw-media-file-facts'));
        const facts = body.querySelector('dl')!; facts.append(node('dt', '', 'Type'), node('dd', '', metadata.mime || 'Unknown'), node('dt', '', 'Size'), node('dd', '', byteLabel(metadata.byteLength)));
        status.textContent = 'This file has no inline reader. Use Open original when available.';
      } else if (metadata.source === 'file') {
        if (!capabilities.read) throw new MediaError('permission_required', 'Permission is required to read this source.');
        const limit = metadata.format === 'pdf' ? MEDIA_LIMITS.pdfBytes : metadata.format === 'docx' ? MEDIA_LIMITS.docxBytes : metadata.format === 'image' ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.textBytes;
        const bytes = await readMediaBytes(port, request(), metadata.byteLength, limit, abort.signal); if (!valid(token)) return;
        // An empty UTF-8 file is a valid empty text document.
        if (metadata.format !== 'text' || bytes.length) assertMediaSignature(metadata, bytes);
        if (metadata.format === 'pdf') await showPdf(bytes, token);
        else if (metadata.format === 'docx') {
          const { parseDocxIsolated } = await import('./media-docx.ts'); if (!valid(token)) return;
          const converted = await parseDocxIsolated(bytes, abort.signal); if (!valid(token)) return;
          const content = mountSafeDocument(body, converted.html);
          findField(query => { const found = highlightDocument(content, query.trim()); found.first?.scrollIntoView({ block: 'center' }); status.textContent = query.trim() ? `${found.count}${found.count >= 1000 ? '+' : ''} matches.` : 'Document ready.'; });
          status.textContent = 'Document ready.' + (converted.omittedImages ? ` ${converted.omittedImages} unsupported images omitted.` : '') + (converted.warnings.length ? ' Some document formatting is not represented.' : '');
        } else if (metadata.format === 'image') {
          const dimensions = imageDimensions(bytes); objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: dimensions.mime }));
          const image = node('img', 'aw-media-image'); image.alt = metadata.name; image.src = objectUrl;
          image.onerror = () => { if (valid(token)) status.textContent = 'The image could not be decoded. Open the original when available.'; };
          body.append(image); status.textContent = `${dimensions.width} × ${dimensions.height}`;
        } else {
          const content = node('pre', 'aw-media-text', new TextDecoder('utf-8', { fatal: true }).decode(bytes)); body.append(content);
          findField(query => { const found = highlightDocument(content, query.trim()); found.first?.scrollIntoView({ block: 'center' }); status.textContent = query.trim() ? `${found.count}${found.count >= 1000 ? '+' : ''} matches.` : 'Text ready.'; }); status.textContent = bytes.length ? 'Text ready. Select and copy the original text.' : 'This text file is empty.';
        }
      }
      if (valid(token)) loadedVersion = resource.version;
    } catch (error) { if (valid(token)) { status.textContent = publicError(error); if (!metadata) tools.append(button('Retry', load)); } }
  }
  void load();
  return {
    update(next) {
      if (disposed) return;
      if (next.id !== initial.id || next.kind !== initial.kind) throw new Error('A media viewer cannot change canonical identity.');
      if (next.version < resource.version && available(next)) return;
      const changed = next.version !== resource.version || available(next) !== available(resource); resource = next; title.textContent = next.title;
      if (changed) { generation++; clear(); if (active) void load(); }
    },
    setActive(value) {
      if (disposed || active === value) return; active = value; root.inert = !value;
      if (!value) { if (loadedVersion < 0) generation++; abort?.abort(); pdf?.cancel(); release(); }
      else if (loadedVersion !== resource.version) void load();
      else { resumePdf?.(); if (playbackButton) playbackButton.disabled = metadata?.format === 'youtube' ? !capabilities?.embed : !capabilities?.play; }
    },
    async flush() { /* Read-only viewers never mutate canonical content. */ },
    dispose() { if (disposed) return; disposed = true; generation++; clear(); root.replaceChildren(); root.classList.remove('aw-media'); delete root.dataset.mediaFormat; delete root.dataset.resourceId; },
  };
}
