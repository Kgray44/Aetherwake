import { MEDIA_LIMITS, type MediaAccessErrorCode, type MediaMetadata, type MediaReadPort, type MediaReadRequest, type MediaPlaybackLease } from '../application-contract/media.ts';

export class MediaError extends Error {
  readonly code: MediaAccessErrorCode;
  constructor(code: MediaAccessErrorCode, message: string) { super(message); this.code = code; }
}
export const mediaFailure = (code: MediaAccessErrorCode, message: string): never => { throw new MediaError(code, message); };
function check(value: unknown, message: string): asserts value { if (!value) mediaFailure('invalid_data', message); }

export function validateMediaMetadata(value: MediaMetadata): MediaMetadata {
  check(value && typeof value === 'object', 'Media metadata is unavailable.');
  check(typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 1024 && !value.name.includes('\0'), 'Invalid source name.');
  check(typeof value.mime === 'string' && value.mime.length <= 200, 'Invalid source media type.');
  check(typeof value.sourceRevision === 'string' && value.sourceRevision.length > 0 && value.sourceRevision.length <= 512, 'Invalid source revision.');
  if (value.source === 'file') {
    check(!/[\\/]/.test(value.name), 'Source names must not contain private file locators.');
    check(['pdf', 'docx', 'video', 'image', 'text', 'binary'].includes(value.format), 'Unknown file format.');
    check(Number.isSafeInteger(value.byteLength) && value.byteLength >= 0, 'Invalid source byte length.');
  } else {
    check(value.source === 'link' && ['web', 'youtube'].includes(value.format), 'Unknown link format.');
    const url = canonicalMediaUrl(value.url);
    if (value.format === 'youtube') check(youtubeVideoId(url.href) === value.youtubeId, 'YouTube identity does not match the canonical link.');
  }
  return value;
}

export function canonicalMediaUrl(input: string): URL {
  check(typeof input === 'string' && input.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(input), 'Invalid link.');
  let url: URL;
  try { url = new URL(input); } catch { return mediaFailure('invalid_data', 'Invalid link.'); }
  check(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !!url.hostname, 'Only ordinary HTTP or HTTPS links are supported.');
  return url;
}
export function youtubeVideoId(input: string): string | null {
  const url = canonicalMediaUrl(input), host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([^/]+)$/.exec(url.pathname)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export type MediaSignature = 'pdf' | 'zip' | 'mp4' | 'webm' | 'ogg-video' | 'png' | 'jpeg' | 'gif' | 'webp' | 'text' | 'binary';
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
export function mediaSignature(bytes: Uint8Array): MediaSignature {
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return 'zip';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 7) === 'PNG\r\n\x1a\n') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 4, 4) === 'ftyp' && ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV', 'qt  '].includes(ascii(bytes, 8, 4))) return 'mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && ascii(bytes, 0, Math.min(bytes.length, 4096)).includes('webm')) return 'webm';
  if (ascii(bytes, 0, 4) === 'OggS' && ascii(bytes, 0, Math.min(bytes.length, 4096)).includes('theora')) return 'ogg-video';
  if (bytes.length && !bytes.includes(0)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'text'; } catch { /* Binary stays binary. */ }
  }
  return 'binary';
}
export function assertMediaSignature(metadata: MediaMetadata, bytes: Uint8Array) {
  if (metadata.source !== 'file') return mediaFailure('invalid_data', 'A link has no local file bytes.');
  const signature = mediaSignature(bytes);
  const allowed: Record<string, readonly MediaSignature[]> = {
    pdf: ['pdf'], docx: ['zip'], image: ['png', 'jpeg', 'gif', 'webp'],
    video: ['mp4', 'webm', 'ogg-video'], text: ['text'], binary: ['binary', 'zip', 'text'],
  };
  if (!allowed[metadata.format].includes(signature)) mediaFailure('invalid_data', 'The actual source bytes do not match the declared media format.');
  return signature;
}

export function imageDimensions(bytes: Uint8Array): { width: number; height: number; mime: string } {
  const signature = mediaSignature(bytes), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, mime = '';
  if (signature === 'png' && bytes.length >= 24) { width = data.getUint32(16); height = data.getUint32(20); mime = 'image/png'; }
  else if (signature === 'gif' && bytes.length >= 10) { width = data.getUint16(6, true); height = data.getUint16(8, true); mime = 'image/gif'; }
  else if (signature === 'webp' && bytes.length >= 30 && ascii(bytes, 12, 4) === 'VP8X') {
    width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); mime = 'image/webp';
  } else if (signature === 'webp' && bytes.length >= 30 && ascii(bytes, 12, 4) === 'VP8 ') {
    width = data.getUint16(26, true) & 0x3fff; height = data.getUint16(28, true) & 0x3fff; mime = 'image/webp';
  } else if (signature === 'webp' && bytes.length >= 25 && ascii(bytes, 12, 4) === 'VP8L' && bytes[20] === 0x2f) {
    width = 1 + bytes[21] + ((bytes[22] & 63) << 8); height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10); mime = 'image/webp';
  } else if (signature === 'jpeg') {
    mime = 'image/jpeg'; let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]; offset += 2;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) { offset--; continue; }
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        height = data.getUint16(offset + 3); width = data.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height) mediaFailure('unsupported', 'Image dimensions could not be validated.');
  if (width * height > MEDIA_LIMITS.imagePixels) mediaFailure('too_large', 'Image exceeds the inline pixel limit.');
  return { width, height, mime };
}

export async function readMediaBytes(port: MediaReadPort, request: MediaReadRequest, length: number, maximum: number, signal?: AbortSignal): Promise<Uint8Array> {
  check(Number.isSafeInteger(length) && length >= 0, 'Invalid file length.');
  if (length > maximum) mediaFailure('too_large', 'This file exceeds the inline preview byte limit. Open the original externally when available.');
  const result = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += MEDIA_LIMITS.chunkBytes) {
    signal?.throwIfAborted();
    const count = Math.min(MEDIA_LIMITS.chunkBytes, length - offset);
    const chunk = await port.readBytes({ ...request, offset, length: count });
    signal?.throwIfAborted();
    if (!(chunk instanceof Uint8Array) || chunk.byteLength !== count) mediaFailure('source_changed', 'The source changed or returned an incomplete read.');
    result.set(chunk, offset);
  }
  return result;
}

export function validatePlaybackLease(lease: MediaPlaybackLease, metadata: MediaMetadata): MediaPlaybackLease {
  check(typeof lease.leaseId === 'string' && lease.leaseId.length > 0 && lease.leaseId.length <= 512, 'Invalid playback lease.');
  let url: URL;
  try { url = new URL(lease.src); } catch { return mediaFailure('invalid_data', 'Invalid playback source.'); }
  check(!url.username && !url.password, 'Playback source contains credentials.');
  if (lease.kind === 'local-video') {
    check(metadata.source === 'file' && metadata.format === 'video' && url.protocol === 'aerynth-media:' && lease.mime.startsWith('video/'), 'Playback requires an approved local media lease.');
  } else {
    check(lease.kind === 'youtube' && metadata.source === 'link' && metadata.format === 'youtube', 'Invalid provider playback type.');
    check(url.protocol === 'https:' && !url.port && url.hostname === 'www.youtube-nocookie.com' && url.pathname === '/embed/' + metadata.youtubeId && url.searchParams.getAll('autoplay').length === 1 && url.searchParams.get('autoplay') === '0', 'Playback requires the exact approved non-autoplay YouTube embed.');
  }
  return lease;
}

/** Root applies this once during explicit initial placement, never as a viewer
 * resize mutation. The shared frame/material remains the existing system. */
export function mediaDefaultGeometry(metadata: MediaMetadata) {
  const values = metadata.format === 'pdf' ? [500, 680, 300, 350]
    : metadata.format === 'docx' ? [520, 620, 320, 320]
    : ['video', 'youtube'].includes(metadata.format) ? [640, 440, 400, 300]
    : metadata.source === 'link' ? [420, 220, 280, 160]
    : metadata.format === 'image' ? [480, 380, 280, 240] : [420, 240, 280, 180];
  const [width, height, minWidth, minHeight] = values;
  return Object.freeze({ width, height, minWidth, minHeight, shape: 'rounded' as const });
}
