import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';

// Explicit test harness. No provider sessions, private data, remote access or shell redesign.
const root = new URL('../', import.meta.url), runtime = new URL('./.runtime/', root);
mkdirSync(runtime, { recursive: true });
const kernel = WorkspaceKernel.open(fileURLToPath(new URL('synthetic-demo.sqlite', runtime)));
kernel.withTransaction(db => {
  const size = Number(db.prepare('PRAGMA page_size').get()!.page_size);
  db.exec(`PRAGMA max_page_count=${Math.floor(32 * 1024 * 1024 / size)}`);
});
const engine = new WorkspaceEngine(kernel);
if (!engine.listWorkspaces().length) engine.createWorkspace('Synthetic blank workspace');
const token = randomBytes(24).toString('hex');
const modulePaths = new Map([
  ['/modules/workspace-engine/interaction.mts', new URL('interaction.mts', root)],
  ['/modules/workspace-engine/contracts.mts', new URL('contracts.mts', root)],
  ['/modules/workspace-engine/geometry.mts', new URL('geometry.mts', root)],
  ['/modules/visual-experience/cinematic-v3/src/motion.ts', new URL('../visual-experience/cinematic-v3/src/motion.ts', root)],
]);
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  try {
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('token') === token) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace('__TOKEN__', token)); return;
    }
    const module = modulePaths.get(url.pathname);
    if (req.method === 'GET' && module) {
      res.setHeader('Content-Type', 'text/javascript'); res.end(stripTypeScriptTypes(readFileSync(module, 'utf8'))); return;
    }
    if (req.method === 'GET' && url.pathname === '/app.mjs') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(new URL('./app.mjs', import.meta.url))); return;
    }
    if (req.method !== 'POST' || req.headers['x-demo-token'] !== token) { res.writeHead(403); res.end('Synthetic harness access only'); return; }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 262144) throw new Error('INPUT_TOO_LARGE'); chunks.push(chunk); }
    const a = JSON.parse(Buffer.concat(chunks).toString()); let result: unknown;
    switch (url.pathname) {
      case '/api/state': result = engine.project(a.workspaceId ?? engine.activeWorkspaceId()!); break;
      case '/api/execute': result = engine.execute(a); break;
      case '/api/create': result = engine.createWorkspace(a.title); break;
      case '/api/rename': result = engine.renameWorkspace(a.workspaceId, a.title, a.expectedVersion); break;
      case '/api/switch': result = engine.switchWorkspace(a.workspaceId); break;
      case '/api/note': result = kernel.updateNote(a.resourceId, a.content, a.expectedVersion); break;
      case '/api/archive': result = engine.setResourceArchived(a.resourceId, a.archived, a.expectedVersion); break;
      case '/api/list': result = { workspaces: engine.listWorkspaces(), resources: kernel.searchResources('', true).map(r => kernel.getResource(r.id)), checkpoints: engine.listCheckpoints(engine.activeWorkspaceId()!) }; break;
      default: res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  } catch (e: any) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: e.code ?? 'INVALID', message: e.message })); }
});
server.listen(Number(process.env.WORKSPACE_DEMO_PORT ?? 0), '127.0.0.1', () => {
  const address = server.address() as { port: number };
  console.log(`Synthetic workspace engine harness: http://127.0.0.1:${address.port}/?token=${token}`);
  console.log('Database is capped at 32 MiB plus up to 32 MiB rollback journal. ReserveGuard before launch.');
});
process.on('SIGINT', () => server.close(() => { kernel.close(); process.exit(0); }));
