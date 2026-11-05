import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const rendererReceiptName = '.aerynth-renderer-build.json';
const contract = 'aerynth.renderer-build@1';
const sha256 = /^[a-f0-9]{64}$/;

async function hashAsset(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

function cleanSource(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }).trim();
  try {
    if (git('status', '--porcelain=v1', '--untracked-files=normal')) return null;
    const [head, tree] = git('show', '-s', '--format=%H%n%T', 'HEAD').split(/\r?\n/);
    return { head, tree };
  } catch {
    // A standalone or dirty development build can still run locally.
    return null;
  }
}

export function reviewRendererReceipt() {
  let root, dist, source;
  return {
    name: 'aerynth-review-renderer-receipt',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      dist = path.resolve(root, config.build.outDir);
      source = cleanSource(root);
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        const current = cleanSource(root);
        if (!source || !current || current.head !== source.head || current.tree !== source.tree) return;
        const entries = await readdir(dist, { recursive: true, withFileTypes: true });
        const assets = Object.create(null);
        for (const entry of entries) {
          if (entry.isDirectory()) continue;
          if (!entry.isFile()) throw Error('Nonregular renderer output: ' + entry.name);
          const file = path.join(entry.parentPath, entry.name);
          const relative = path.relative(dist, file).split(path.sep).join('/');
          assets[relative] = await hashAsset(file);
        }
        await writeFile(path.join(dist, rendererReceiptName),
          JSON.stringify({ contract, ...source, assets }) + '\n', { flag: 'wx' });
      },
    },
  };
}

export async function readRendererReceipt(dist, candidate, assets) {
  const receipt = path.join(dist, rendererReceiptName);
  const stat = await lstat(receipt).catch(error => {
    if (error.code === 'ENOENT') throw Error('renderer_receipt_missing: run npm run build from the clean candidate');
    throw error;
  });
  if (!stat.isFile() || stat.size > 512 * 1024) throw Error('renderer_receipt_invalid');
  const bytes = await readFile(receipt);
  const value = JSON.parse(bytes);
  if (value?.contract !== contract || value.head !== candidate.head || value.tree !== candidate.tree) {
    throw Error('renderer_receipt_candidate_mismatch: run npm run build from the clean candidate');
  }
  if (!value.assets || Object.keys(value.assets).length !== assets.length ||
      assets.some(name => !Object.hasOwn(value.assets, name) || typeof value.assets[name] !== 'string' ||
        !sha256.test(value.assets[name]))) {
    throw Error('renderer_receipt_inventory_mismatch');
  }
  for (const name of assets) {
    if (await hashAsset(path.join(dist, name)) !== value.assets[name]) {
      throw Error('renderer_output_changed_since_build: ' + name);
    }
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), assets: value.assets };
}
