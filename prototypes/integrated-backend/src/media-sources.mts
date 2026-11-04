import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { openSync,closeSync,fstatSync,readFileSync,realpathSync } from 'node:fs';
import { basename, extname, isAbsolute } from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { MEDIA_LIMITS, type MediaFileFormat, type MediaImportRequest, type MediaMetadata, type MediaReadRequest } from '../../application-contract/media.ts';
import { canonicalMediaUrl, mediaSignature, youtubeVideoId } from '../../block-library/media-policy.ts';
import { ensure, ServiceError } from './contracts.mts';

export type MediaSelection = { kind: 'file'; path: string } | { kind: 'link'; url: string };
export type MediaSource = { metadata: MediaMetadata; path: string | null };

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sourceRevision = (stat: BigIntStats) => hash(
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'),
);
/** Shared native stat identity for atomic reviewed import; never contains file contents or paths. */
export const mediaSourceRevision=sourceRevision;
const localPath = (path: string) => isAbsolute(path) &&
  (process.platform !== 'win32' || /^[a-z]:[\\/][^:]*$/i.test(path)) &&
  !path.includes('\0') && path.length <= 32767;
const displayName = (name: string) => name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120) || 'Imported media';

const previewFormats: Partial<Record<MediaFileFormat, number>> = {
  pdf: MEDIA_LIMITS.pdfBytes, docx: MEDIA_LIMITS.docxBytes,
  image: MEDIA_LIMITS.imageBytes, text: MEDIA_LIMITS.textBytes,
};
const playableExtensions: Partial<Record<MediaFileFormat, readonly string[]>> = {
  pdf: ['.pdf'], docx: ['.docx'], video: ['.mp4', '.mov', '.webm', '.ogv'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp'], text: ['.txt', '.md', '.csv', '.log', '.json'],
};

export function readMediaSource(db: DatabaseSync, resourceId: string): MediaSource | null {
  const row = db.prepare('SELECT metadata_json, selected_path FROM media_sources WHERE resource_id=?').get(resourceId);
  return row ? { metadata: JSON.parse(String(row.metadata_json)), path: typeof row.selected_path === 'string' ? row.selected_path : null } : null;
}

function inspectFile(header: Uint8Array, extension: string): Pick<Extract<MediaMetadata, { source: 'file' }>, 'format' | 'mime'> {
  const signature = mediaSignature(header);
  switch (signature) {
    case 'pdf': return { format: 'pdf', mime: 'application/pdf' };
    case 'zip':
      if (extension === '.docx') return { format: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      break;
    case 'mp4': return { format: 'video', mime: 'video/mp4' };
    case 'webm': return { format: 'video', mime: 'video/webm' };
    case 'ogg-video': return { format: 'video', mime: 'video/ogg' };
    case 'png': case 'jpeg': case 'gif': case 'webp':
      return { format: 'image', mime: 'image/' + signature };
    case 'text': return { format: 'text', mime: 'text/plain' };
  }
  return { format: 'binary', mime: 'application/octet-stream' };
}

export async function inspectMediaSelection(selection: MediaSelection, variant?: MediaImportRequest['variant']): Promise<MediaSource> {
  if (selection.kind === 'link') {
    ensure(variant === undefined, 'invalid_media_request');
    let url: URL;
    try { url = canonicalMediaUrl(selection.url); }
    catch { throw new ServiceError('invalid_media_link'); }
    const youtubeId = youtubeVideoId(url.href);
    const identity = { source: 'link' as const, name: youtubeId ? 'YouTube video' : displayName(url.hostname),
      mime: 'text/html', url: url.href, sourceRevision: hash(url.href) };
    return { metadata: youtubeId ? { ...identity, format: 'youtube', youtubeId } : { ...identity, format: 'web' }, path: null };
  }
  ensure(typeof selection.path === 'string' && localPath(selection.path), 'invalid_media_source');
  try {
    const path = await realpath(selection.path);
    ensure(localPath(path), 'invalid_media_source');
    const file = await open(path, 'r');
    try {
      const stat = await file.stat({ bigint: true });
      ensure(stat.isFile() && stat.size <= BigInt(Number.MAX_SAFE_INTEGER), 'invalid_media_source');
      const header = Buffer.alloc(Math.min(4096, Number(stat.size)));
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      ensure(sourceRevision(stat) === sourceRevision(await file.stat({ bigint: true })), 'source_changed');
      const descriptor = inspectFile(header.subarray(0, bytesRead), extname(path).toLowerCase());
      ensure(variant === undefined || variant === 'any' ||
        (variant === 'document' ? ['pdf', 'docx', 'text'].includes(descriptor.format) : variant === descriptor.format),
        'media_format_mismatch');
      return { path, metadata: { source: 'file', ...descriptor, name: displayName(basename(path)),
        byteLength: Number(stat.size), sourceRevision: sourceRevision(stat) } };
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('media_source_unavailable');
  }
}

export function mediaCapabilities(source: MediaSource) {
  const m = source.metadata;
  const max = m.source === 'file' ? previewFormats[m.format] : undefined;
  return {
    read: m.source === 'file' && max !== undefined && m.byteLength <= max,
    play: m.source === 'file' && m.format === 'video' && m.byteLength > 0,
    embed: false,
    openExternal: m.source === 'link' || !!(source.path && playableExtensions[m.format]?.includes(extname(source.path).toLowerCase())),
  };
}

/** Only an explicitly selected canonical text resource may call this synchronous host content port. */
export function readSelectedMediaText(source:MediaSource,maxBytes=12000):string|null{
  if(!source.path||source.metadata.source!=='file'||source.metadata.format!=='text'||source.metadata.byteLength>maxBytes)return null;
  ensure(realpathSync(source.path)===source.path,'source_changed');const fd=openSync(source.path,'r');
  try{const current=()=>{const stat=fstatSync(fd,{bigint:true});ensure(stat.isFile()&&sourceRevision(stat)===source.metadata.sourceRevision,'source_changed');};current();
    const bytes=readFileSync(fd);ensure(bytes.byteLength===source.metadata.byteLength&&bytes.byteLength<=maxBytes,'source_changed');
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}finally{bytes.fill(0);}current();return text;
  }finally{closeSync(fd);}
}

async function withCurrentFile<T>(source: MediaSource, inspect: (file: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  const path = source.path;
  ensure(path && localPath(path), 'media_source_unavailable');
  try {
    ensure(await realpath(path) === path, 'source_changed');
    const file = await open(path, 'r');
    try {
      const unchanged = async () => {
        const stat = await file.stat({ bigint: true });
        ensure(stat.isFile() && sourceRevision(stat) === source.metadata.sourceRevision, 'source_changed');
      };
      await unchanged();
      const result = await inspect(file);
      await unchanged();
      return result;
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('media_source_unavailable');
  }
}

export async function readMediaChunk(source: MediaSource, input: MediaReadRequest & { offset: number; length: number; playback?: true }): Promise<string> {
  const m = source.metadata;
  const capabilities = mediaCapabilities(source);
  ensure(m.source === 'file' && (input.playback === true ? capabilities.play : capabilities.read), 'unsupported_media_read');
  ensure(Number.isSafeInteger(input.offset) && input.offset >= 0 &&
    Number.isSafeInteger(input.length) && input.length > 0 && input.length <= MEDIA_LIMITS.chunkBytes &&
    input.offset <= m.byteLength - input.length, 'invalid_media_range');
  return withCurrentFile(source, async file => {
    const chunk = Buffer.alloc(input.length);
    let read = 0;
    while (read < chunk.length) {
      const { bytesRead } = await file.read(chunk, read, chunk.length - read, input.offset + read);
      ensure(bytesRead > 0, 'source_changed');
      read += bytesRead;
    }
    return chunk.toString('base64');
  });
}

export async function mediaExternalTarget(source: MediaSource): Promise<MediaSelection> {
  ensure(mediaCapabilities(source).openExternal, 'unsupported_media_open');
  if (source.metadata.source === 'link')
    return { kind: 'link', url: canonicalMediaUrl(source.metadata.url).href };
  return withCurrentFile(source, async () => ({ kind: 'file', path: source.path! }));
}
