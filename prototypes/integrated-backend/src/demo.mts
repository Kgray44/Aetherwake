import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { journey } from './journey.mts';
const live = process.argv.includes('--live');
const root = resolve('runtime', (live ? 'live-' : 'fixture-') + Date.now());
mkdirSync(root, { recursive: true });
try {
  console.log(JSON.stringify(await journey({ path: resolve(root, 'backend.sqlite'), provider: live ? 'codex' : 'fixture', contentPolicy: 'synthetic-only', cwd: process.cwd(), codexExecutable: process.env.AERYNTH_CODEX_EXE }), null, 2));
} catch { console.error(JSON.stringify({ success: false, detail: 'Inspect local synthetic state; no raw diagnostics exported.' })); process.exitCode = 1; }
