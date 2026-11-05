import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { openPdf } from '../media-pdf.ts';
import { parseDocx, boundedDocxArchive } from '../media-docx-parser.ts';
import { MEDIA_LIMITS } from '../../application-contract/media.ts';
import { pdfFixture, docxFixture, docxParts } from './media-fixtures.mts';
import { assertMediaSignature, mediaDefaultGeometry, imageDimensions, readMediaBytes, validateMediaMetadata, validatePlaybackLease } from '../media-policy.ts';

const metadata = (format: 'pdf' | 'docx' | 'image' | 'text' = 'pdf') => ({ source: 'file' as const, format, name: 'Synthetic source', mime: 'application/octet-stream', byteLength: 20, sourceRevision: 'revision:actual' });
test('actual PDF.js reads page count, real text, and paints a bounded CPU canvas from an intact synthetic PDF', async () => {
  const bytes = pdfFixture(), before = bytes.slice(), pdf = await openPdf(bytes);
  try {
    assert.equal(pdf.pageCount, 2); assert.match(await pdf.text(1), /Synthetic PDF first page/); assert.match(await pdf.text(2), /Searchable second page/);
    const { createCanvas } = await import('@napi-rs/canvas'); const canvas = createCanvas(1, 1);
    const rendered = await pdf.render(1, canvas as unknown as HTMLCanvasElement, null, 3);
    assert.ok(rendered); assert.ok(canvas.width * canvas.height <= MEDIA_LIMITS.canvasPixels + canvas.width + canvas.height);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 128 && pixels[index + 3] > 0) dark++;
    assert.ok(dark > 100, 'Actual PDF content was painted, not an empty white canvas');
    assert.deepEqual(bytes, before, 'PDF.js owns a copy; original bytes remain intact');
    await assert.rejects(pdf.text(0), /Invalid PDF page/);
  } finally { await pdf.dispose(); }
});
test('actual Mammoth converts DOCX headings, formatting and tables after a bounded streamed ZIP validation', async () => {
  const bytes = docxFixture(), before = bytes.slice(), result = await parseDocx(bytes);
  assert.match(result.html, /<h1>Synthetic document<\/h1>/); assert.match(result.html, /<strong>bold text<\/strong>/); assert.match(result.html, /<table>/);
  assert.match(result.html, /Table cell/); assert.deepEqual(bytes, before); assert.equal(result.omittedImages, 0);
});
test('invalid/non-Word/oversized-entry/lying-expansion ZIPs fail before Word conversion', () => {
  assert.throws(() => boundedDocxArchive(new Uint8Array([1, 2])), /complete single-volume/);
  assert.throws(() => boundedDocxArchive(zipSync({ other: strToU8('hello') })), /not a supported Word/);
  assert.throws(() => boundedDocxArchive(zipSync(docxParts(Object.fromEntries(Array.from({ length: 256 }, (_, n) => [`extra${n}`, strToU8('x')]))))), /entry limit/);
  const bytes = zipSync(docxParts({ 'extra.txt': new Uint8Array(100000).fill(65) })), view = new DataView(bytes.buffer);
  for (let offset = 0; offset < bytes.length - 46; offset++) if (view.getUint32(offset, true) === 0x02014b50) {
    const size = view.getUint16(offset + 28, true), name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + size));
    if (name === 'extra.txt') { view.setUint32(offset + 24, 1, true); break; }
  }
  assert.throws(() => boundedDocxArchive(bytes), /Actual DOCX expansion/);
});
test('actual byte signatures and dimensions control viewers; every media flavor has an appropriate rounded initial geometry', () => {
  assert.throws(() => assertMediaSignature(metadata('pdf'), strToU8('fake.pdf')), /actual source bytes/);
  assert.throws(() => assertMediaSignature(metadata('image'), strToU8('<svg onload="x"/>')), /actual source bytes/);
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  assert.deepEqual(imageDimensions(png), { width: 1, height: 1, mime: 'image/png' });
  new DataView(png.buffer).setUint32(16, 100000); new DataView(png.buffer).setUint32(20, 100000); assert.throws(() => imageDimensions(png), /pixel limit/);
  assert.notDeepEqual(mediaDefaultGeometry(metadata('pdf')), mediaDefaultGeometry(metadata('docx')));
  assert.equal(mediaDefaultGeometry(metadata()).shape, 'rounded');
});
test('chunked reads preserve current canonical/version/source fences, reject JSON maps and stop on abort', async () => {
  const request = { resourceId: 'canonical:file', expectedVersion: 9, sourceRevision: 'revision:9' }, calls: any[] = [], controller = new AbortController();
  const port: any = { readBytes: async (input: any) => { calls.push(input); return new Uint8Array(input.length).fill(7); } };
  const bytes = await readMediaBytes(port, request, MEDIA_LIMITS.chunkBytes + 12, MEDIA_LIMITS.pdfBytes);
  assert.equal(bytes.length, MEDIA_LIMITS.chunkBytes + 12); assert.deepEqual(calls.map(call => [call.offset, call.length, call.expectedVersion, call.sourceRevision]), [[0, MEDIA_LIMITS.chunkBytes, 9, 'revision:9'], [MEDIA_LIMITS.chunkBytes, 12, 9, 'revision:9']]);
  await assert.rejects(readMediaBytes({ readBytes: async () => ({ 0: 7 }) } as any, request, 1, 2), /incomplete read/);
  calls.length = 0; port.readBytes = async (input: any) => { calls.push(input); controller.abort(); return new Uint8Array(input.length); };
  await assert.rejects(readMediaBytes(port, request, MEDIA_LIMITS.chunkBytes + 1, MEDIA_LIMITS.pdfBytes, controller.signal)); assert.equal(calls.length, 1);
});
test('link and player validation rejects unsafe URLs, arbitrary HTTP media and mismatched YouTube identities', () => {
  assert.throws(() => validateMediaMetadata({ source: 'link', format: 'web', name: 'x', mime: 'text/html', sourceRevision: 'r', url: 'javascript:alert(1)' }), /HTTP or HTTPS/);
  const youtube = { source: 'link' as const, format: 'youtube' as const, name: 'Video', mime: 'text/html', sourceRevision: 'r', url: 'https://youtu.be/abcdefghijk', youtubeId: 'abcdefghijk' };
  validateMediaMetadata(youtube);
  assert.throws(() => validateMediaMetadata({ ...youtube, youtubeId: 'otherId0000' }), /identity/);
  assert.throws(() => validatePlaybackLease({ leaseId: 'l', kind: 'local-video', src: 'https://example.org/v.mp4', mime: 'video/mp4' }, { ...metadata(), format: 'video' }), /approved local/);
  assert.throws(() => validatePlaybackLease({ leaseId: 'l', kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1', mime: 'text/html' }, youtube), /non-autoplay/);
});
