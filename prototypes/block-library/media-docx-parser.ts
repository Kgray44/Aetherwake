import mammoth from 'mammoth';
import { Unzip, UnzipInflate, zipSync } from 'fflate';
import { MEDIA_LIMITS } from '../application-contract/media.ts';
import { MediaError, imageDimensions } from './media-policy.ts';

/** Validate the actual streamed expansion, then give Mammoth a temporary
 * archive made only from those validated parts. The original bytes are never
 * modified. This prevents different central/local ZIP views from bypassing
 * the expansion check. No part is extracted to a filesystem. */
export function boundedDocxArchive(bytes: Uint8Array): Uint8Array {
  if (bytes.length > MEDIA_LIMITS.docxBytes) throw new MediaError('too_large', 'DOCX exceeds the inline byte limit.');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--)
    if (data.getUint32(offset, true) === 0x06054b50 && offset + 22 + data.getUint16(offset + 20, true) === bytes.length) { eocd = offset; break; }
  if (eocd < 0 || data.getUint16(eocd + 4, true) || data.getUint16(eocd + 6, true)) throw new MediaError('invalid_data', 'A complete single-volume DOCX ZIP is required.');
  const count = data.getUint16(eocd + 10, true), directorySize = data.getUint32(eocd + 12, true), start = data.getUint32(eocd + 16, true);
  if (count > MEDIA_LIMITS.zipEntries || count === 65535) throw new MediaError('too_large', 'DOCX exceeds the entry limit.');
  if (start + directorySize !== eocd || data.getUint16(eocd + 8, true) !== count) throw new MediaError('invalid_data', 'Invalid DOCX ZIP directory.');
  const expected = new Map<string, { size: number; compression: number }>();
  let offset = start, declared = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || data.getUint32(offset, true) !== 0x02014b50) throw new MediaError('invalid_data', 'Invalid DOCX entry.');
    const flags = data.getUint16(offset + 8, true), compression = data.getUint16(offset + 10, true), size = data.getUint32(offset + 24, true);
    const nameLength = data.getUint16(offset + 28, true), extra = data.getUint16(offset + 30, true), comment = data.getUint16(offset + 32, true);
    if ((flags & 1) || ![0, 8].includes(compression)) throw new MediaError('unsupported', 'Encrypted or unsupported ZIP entries require an external viewer.');
    if (offset + 46 + nameLength + extra + comment > eocd) throw new MediaError('invalid_data', 'Truncated DOCX directory.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || /[\0\\]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || expected.has(name)) throw new MediaError('invalid_data', 'Invalid or duplicate DOCX part name.');
    declared += size;
    if (declared > MEDIA_LIMITS.expandedDocxBytes) throw new MediaError('too_large', 'DOCX exceeds the expanded byte limit.');
    expected.set(name, { size, compression }); offset += 46 + nameLength + extra + comment;
  }
  if (offset !== eocd || !expected.has('[Content_Types].xml') || !expected.has('word/document.xml')) throw new MediaError('invalid_data', 'This archive is not a supported Word document.');
  const parts: Record<string, Uint8Array> = Object.create(null), names = new Set<string>();
  let expanded = 0, pending = 0, failure: MediaError | undefined;
  const started = performance.now();
  const unzip = new Unzip(file => {
    const entry = expected.get(file.name);
    if (!entry || names.has(file.name) || entry.compression !== file.compression) throw new MediaError('invalid_data', 'DOCX local and central entries disagree.');
    names.add(file.name); pending++;
    const chunks: Uint8Array[] = []; let size = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) { failure = new MediaError('invalid_data', 'DOCX compressed data is damaged.'); return; }
      size += chunk.length; expanded += chunk.length;
      if (expanded > MEDIA_LIMITS.expandedDocxBytes || size > entry.size) { file.terminate(); failure = new MediaError('too_large', 'Actual DOCX expansion exceeds its bound.'); return; }
      chunks.push(chunk);
      if (final) {
        if (size !== entry.size) { failure = new MediaError('invalid_data', 'DOCX expanded size does not match its directory.'); return; }
        const part = new Uint8Array(size); let position = 0;
        for (const value of chunks) { part.set(value, position); position += value.length; }
        parts[file.name] = part; pending--;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Count actual decoded chunks before Mammoth. The budget is processed data,
  // not an OS heap quota; the isolated worker also has a real time deadline.
  for (let position = 0; position < bytes.length; position += 1024) {
    if (performance.now() - started > MEDIA_LIMITS.parserTimeoutMs) throw new MediaError('timeout', 'DOCX expansion exceeded its time limit.');
    unzip.push(bytes.subarray(position, position + 1024), position + 1024 >= bytes.length);
    if (failure) throw failure;
  }
  if (pending || names.size !== expected.size) throw new MediaError('invalid_data', 'Incomplete DOCX expansion.');
  const types = new TextDecoder().decode(parts['[Content_Types].xml']);
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw new MediaError('unsupported', 'Only standard DOCX documents are supported inline.');
  return zipSync(parts, { level: 0 });
}

/** Actual Word conversion; never use its HTML as live innerHTML. The caller
 * rebuilds a restricted semantic DOM. External source-file access is disabled. */
export async function parseDocx(bytes: Uint8Array) {
  const archive = boundedDocxArchive(bytes);
  let imagePixels = 0, omittedImages = 0;
  const result = await mammoth.convertToHtml(
    typeof process !== 'undefined' && typeof process.versions?.node === 'string' ? { buffer: Buffer.from(archive) } : { arrayBuffer: archive.buffer as ArrayBuffer },
    { externalFileAccess: false, includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async image => {
        try {
          const data = new Uint8Array(await image.readAsArrayBuffer());
          if (data.length > MEDIA_LIMITS.imageBytes) throw new Error('large image');
          const dimensions = imageDimensions(data); imagePixels += dimensions.width * dimensions.height;
          if (imagePixels > MEDIA_LIMITS.imagePixels) throw new Error('document image budget');
          return { src: 'data:' + dimensions.mime + ';base64,' + await image.readAsBase64String() };
        } catch { omittedImages++; return { src: '' }; }
      }),
    },
  );
  if (result.value.length > MEDIA_LIMITS.expandedDocxBytes) throw new MediaError('too_large', 'Document preview exceeds its text budget.');
  return { html: result.value, warnings: result.messages.map(message => message.message), omittedImages };
}

/** Body text for explicitly selected source context; no HTML, images or external reads. */
export async function extractDocxBodyText(bytes:Uint8Array){
  const archive=boundedDocxArchive(bytes);
  try{const input=typeof process!=='undefined'&&typeof process.versions?.node==='string'?{buffer:Buffer.from(archive),externalFileAccess:false}:{arrayBuffer:archive.buffer as ArrayBuffer,externalFileAccess:false};return await mammoth.extractRawText(input);}
  finally{archive.fill(0);}
}
