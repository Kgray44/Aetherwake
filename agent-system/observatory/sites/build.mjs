import { build } from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const project = resolve(here, '..');
const output = resolve(process.argv[2] || join(project, 'dist'));
const sourceRevision = process.env.OBSERVATORY_SOURCE_REVISION ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('An exact source commit is required');

const schema = JSON.parse(await readFile(join(project, '../contracts/v1.schema.json'), 'utf8'));
const ajv = new Ajv2020({ code: { source: true, esm: true }, strict: false });
addFormats(ajv);
const validator = standalone(ajv, ajv.compile(schema));
const traceSchema = JSON.parse(await readFile(join(project, '../contracts/trace-v1.schema.json'), 'utf8'));
const eventValidator = standalone(ajv, ajv.compile(traceSchema));

const ui = join(project, 'dist');
const assets = {
  '/': { type: 'text/html; charset=utf-8', content: await readFile(join(ui, 'index.html'), 'utf8') },
};
assets['/index.html'] = assets['/'];
const types = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
for (const file of await readdir(join(ui, 'assets'))) {
  const type = types[file.split('.').at(-1)];
  if (!type) throw new Error('Unsupported bundled asset ' + file);
  assets['/assets/' + file] = { type, content: await readFile(join(ui, 'assets', file), 'utf8') };
}

const temporary = await mkdtemp(join(project, 'dist/.sites-build-'));
try {
  await writeFile(join(temporary, 'validator.mjs'), validator);
  await writeFile(join(temporary, 'event-validator.mjs'), eventValidator);
  await build({
    stdin: {
      contents: `import { createWorker } from './sites/worker.mjs';
        import validate from ${JSON.stringify(join(temporary, 'validator.mjs'))};
        import validateEvent from ${JSON.stringify(join(temporary, 'event-validator.mjs'))};
        export default createWorker({ validate, validateEvent, assets: ${JSON.stringify(assets)}, sourceRevision: ${JSON.stringify(sourceRevision)} });`,
      resolveDir: project,
    },
    bundle: true,
    format: 'esm',
    minify: true,
    outfile: join(output, 'server/index.js'),
  });
  await mkdir(join(output, '.openai'), { recursive: true });
  await cp(join(here, 'drizzle'), join(output, '.openai/drizzle'), { recursive: true });
} finally {
  await rm(temporary, { recursive: true, force: true });
}

