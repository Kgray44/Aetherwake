import { createHash } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { check } from '../../vela-core/src/capabilities.ts';
import { missionImageMaxBytes, missionImageSize } from '../../openai-provider/images.mts';

export const missionArtifactSource = 'aerynth.workspace.verified-artifacts';
export const missionArtifactFiles = ['illustration.png', 'illustration-notes.txt'] as const;
type ArtifactName = typeof missionArtifactFiles[number];

export function verifyMissionPng(bytes: Buffer) {
  check(bytes.length >= 45 && bytes.length <= missionImageMaxBytes &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'mission_image_invalid');
  const data: Buffer[] = [];
  let offset = 8, channels = 0;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    check(end <= bytes.length && crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'mission_image_invalid');
    const type = bytes.toString('ascii', offset + 4, offset + 8), body = bytes.subarray(offset + 8, end - 4);
    if (offset === 8) {
      check(type === 'IHDR' && length === 13 && body.readUInt32BE(0) === missionImageSize &&
        body.readUInt32BE(4) === missionImageSize && body[8] === 8 && (body[9] === 2 || body[9] === 6) &&
        body[10] === 0 && body[11] === 0 && body[12] === 0, 'mission_image_constraints_not_met');
      channels = body[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') {
      check(length === 0 && end === bytes.length && data.length > 0, 'mission_image_invalid');
      const stride = missionImageSize * channels + 1;
      const pixels = inflateSync(Buffer.concat(data), { maxOutputLength: stride * missionImageSize });
      check(pixels.length === stride * missionImageSize, 'mission_image_invalid');
      for (let row = 0; row < pixels.length; row += stride) check(pixels[row] <= 4, 'mission_image_invalid');
      return;
    } else check(/^[a-z][A-Za-z]{3}$/u.test(type), 'mission_image_invalid');
    offset = end;
  }
  check(false, 'mission_image_invalid');
}

function checkedDirectory(path: string) {
  const stat = lstatSync(path, { bigint: true });
  check(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync.native(path) === path, 'mission_artifact_directory_changed');
  return `${stat.dev}:${stat.ino}`;
}

export function missionArtifactPath(root: string, missionId: string, name: ArtifactName) {
  check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(missionId) &&
    missionArtifactFiles.includes(name), 'invalid_mission_artifact');
  return join(root, 'mission-artifacts', missionId, name);
}

export function readMissionArtifact(path: string, name: ArtifactName) {
  const before = lstatSync(path, { bigint: true });
  const limit = name === 'illustration.png' ? missionImageMaxBytes : 8192;
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size > 0n &&
    before.size <= BigInt(limit) && realpathSync.native(path) === path, 'mission_artifact_unavailable');
  const fd = openSync(path, 'r');
  try {
    const identity = (stat: typeof before) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    check(identity(fstatSync(fd, { bigint: true })) === identity(before), 'mission_artifact_changed');
    const bytes = Buffer.alloc(Number(before.size));
    check(readSync(fd, bytes, 0, bytes.length, 0) === bytes.length, 'mission_artifact_changed');
    check(identity(fstatSync(fd, { bigint: true })) === identity(before) &&
      identity(lstatSync(path, { bigint: true })) === identity(before), 'mission_artifact_changed');
    if (name === 'illustration.png') verifyMissionPng(bytes);
    else new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { closeSync(fd); }
}

export function writeMissionArtifacts(root: string, missionId: string, png: Buffer, notes: string, validate: () => void) {
  verifyMissionPng(png);
  check(Buffer.byteLength(notes) > 0 && Buffer.byteLength(notes) <= 8192, 'invalid_mission_artifact_notes');
  const rootIdentity = checkedDirectory(root);
  const parent = join(root, 'mission-artifacts');
  const target = dirname(missionArtifactPath(root, missionId, missionArtifactFiles[0]));
  validate();
  try { mkdirSync(parent, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const parentIdentity = checkedDirectory(parent);
  check(checkedDirectory(root) === rootIdentity, 'mission_artifact_directory_changed');
  mkdirSync(target, { mode: 0o700 });
  const targetIdentity = checkedDirectory(target);
  return missionArtifactFiles.map(name => {
    validate();
    check(checkedDirectory(root) === rootIdentity && checkedDirectory(parent) === parentIdentity &&
      checkedDirectory(target) === targetIdentity, 'mission_artifact_directory_changed');
    const path = missionArtifactPath(root, missionId, name);
    const bytes = name === 'illustration.png' ? png : Buffer.from(notes);
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); }
    finally { closeSync(fd); }
    const proof = readMissionArtifact(path, name);
    check(proof.sha256 === createHash('sha256').update(bytes).digest('hex'), 'mission_artifact_readback_failed');
    return { name, path, ...proof };
  });
}
