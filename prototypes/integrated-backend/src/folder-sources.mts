import { createHash, randomUUID } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { lstatSync, realpathSync, type BigIntStats } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FolderMetadata, FolderDescription, FolderBrowseRequest, FolderBrowseResponse, FolderEntry } from '../../application-contract/folder.ts';
import { ensure, ServiceError } from './contracts.mts';

export const FOLDER_LIMITS = Object.freeze({ pageSize: 64, entries: 2048, leases: 4096, snapshots: 32, leaseMs: 120000, timeoutMs: 1500 });
/** Native/backend only. None of these locator or grant fields are renderer DTOs. */
export interface FolderSource {
  path: string;
  identity: string;
  sourceGrantId: string;
  privateRoot: string | null;
  metadata: FolderMetadata;
}
export interface StoredFolderSource extends FolderSource { resourceId: string; projectId: string | null; grantState: 'active' | 'revoked' }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const key = (v: string) => process.platform === 'win32' ? v.toLowerCase() : v;
const within = (root: string, target: string) => { const r = path.relative(root, target); return r === '' || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r)); };
const local = (v: unknown): v is string => typeof v === 'string' && path.isAbsolute(v) && v.length <= 32767 && !v.includes('\0') &&
  (process.platform !== 'win32' || /^[a-z]:[\\/][^:]*$/iu.test(v));
const display = (v: string) => v.replace(/[\x00-\x1f\x7f\p{Bidi_Control}]/gu, '').trim().slice(0, 120) || 'Local folder';
const identity = (s: BigIntStats) => hash(['folder-identity@1', String(s.dev), String(s.ino), String(s.birthtimeNs)]);
const revision = (s: BigIntStats) => hash(['folder-metadata@1', identity(s), String(s.mtimeNs), String(s.ctimeNs)]);
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\x00-\x1f\x7f]/u.test(v);
const validProject = (v: unknown): v is string | null => v === null || validId(v);
const safeError = (e: unknown): never => { if (e instanceof ServiceError) throw e; throw new ServiceError('folder_source_unavailable'); };

function noLinksSync(absolute: string) {
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const s = lstatSync(current, { bigint: true });
    ensure(s.isDirectory() && !s.isSymbolicLink(), 'folder_source_restricted');
  }
}
async function noLinks(absolute: string) {
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const s = await lstat(current, { bigint: true });
    ensure(s.isDirectory() && !s.isSymbolicLink(), 'folder_source_restricted');
  }
}
async function exclusion(root?: string | null) {
  if (!root) return null;
  ensure(local(root), 'invalid_folder_source');
  try { return await realpath(root); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return path.resolve(root); return safeError(e); }
}
function denied(target: string, roots: readonly (string | null | undefined)[]) {
  ensure(!roots.some(root => root && within(root, target)), 'folder_source_restricted');
}
function metadataValid(v: any): v is FolderMetadata {
  return v && Object.keys(v).length === 3 && v.source === 'folder' && typeof v.name === 'string' && v.name === display(v.name) &&
    typeof v.sourceRevision === 'string' && /^[a-f0-9]{64}$/u.test(v.sourceRevision);
}
function sourceValid(v: FolderSource) {
  ensure(v && local(v.path) && /^[a-f0-9]{64}$/u.test(v.identity) && /^[a-f0-9-]{36}$/u.test(v.sourceGrantId) &&
    (v.privateRoot === null || local(v.privateRoot)) && metadataValid(v.metadata), 'invalid_folder_source');
}

/** Inspection never enumerates children or opens file contents. Native selection is its caller's authority. */
export async function inspectFolderSelection(selected: string, privateRoot?: string): Promise<FolderSource> {
  ensure(local(selected), 'invalid_folder_source');
  try {
    const original = path.resolve(selected); await noLinks(original);
    const actual = await realpath(original); ensure(local(actual), 'invalid_folder_source'); await noLinks(actual);
    const excluded = await exclusion(privateRoot); denied(actual, [excluded]);
    const before = await lstat(actual, { bigint: true });
    ensure(before.isDirectory() && !before.isSymbolicLink(), 'invalid_folder_source');
    ensure(revision(before) === revision(await lstat(actual, { bigint: true })), 'folder_source_changed');
    return { path: actual, identity: identity(before), sourceGrantId: randomUUID(), privateRoot: excluded,
      metadata: { source: 'folder', name: display(path.basename(actual)), sourceRevision: revision(before) } };
  } catch (e) { return safeError(e); }
}

/** Synchronous fence for the caller's one canonical resource/placement transaction. */
export function assertCurrentFolderSourceSync(source: FolderSource, exactRevision = false): void {
  sourceValid(source);
  try {
    noLinksSync(source.path); denied(source.path, [source.privateRoot]);
    ensure(same(realpathSync(source.path), source.path), 'folder_source_changed');
    const s = lstatSync(source.path, { bigint: true });
    ensure(s.isDirectory() && !s.isSymbolicLink() && identity(s) === source.identity, 'folder_source_changed');
    if (exactRevision) ensure(revision(s) === source.metadata.sourceRevision, 'folder_source_changed');
  } catch (e) { safeError(e); }
}
export async function assertCurrentFolderSource(source: FolderSource, privateRoot?: string): Promise<BigIntStats> {
  sourceValid(source);
  try {
    await noLinks(source.path); denied(source.path, [source.privateRoot, await exclusion(privateRoot)]);
    ensure(same(await realpath(source.path), source.path), 'folder_source_changed');
    const s = await lstat(source.path, { bigint: true });
    ensure(s.isDirectory() && !s.isSymbolicLink() && identity(s) === source.identity, 'folder_source_changed');
    return s;
  } catch (e) { return safeError(e); }
}

export function readFolderSource(db: DatabaseSync, resourceId: string): StoredFolderSource | null {
  ensure(validId(resourceId), 'invalid_folder_request');
  const row = db.prepare('SELECT * FROM folder_sources WHERE resource_id=?').get(resourceId);
  if (!row) return null;
  try {
    const source: StoredFolderSource = { resourceId, projectId: row.project_id === null ? null : String(row.project_id), path: String(row.selected_path),
      identity: String(row.source_identity), sourceGrantId: String(row.source_grant_id), privateRoot: row.private_root === null ? null : String(row.private_root),
      metadata: JSON.parse(String(row.metadata_json)), grantState: String(row.grant_state) as StoredFolderSource['grantState'] };
    sourceValid(source); ensure(validProject(source.projectId) && ['active', 'revoked'].includes(source.grantState) && row.grant_scope === 'metadata-only', 'folder_source_unavailable');
    return source;
  } catch (e) { return safeError(e); }
}
function scoped(db: DatabaseSync, resourceId: string, projectId: string | null, allowRevoked = false) {
  ensure(validProject(projectId), 'invalid_folder_request');
  const source = readFolderSource(db, resourceId); ensure(source, 'folder_source_not_found');
  ensure(source.projectId === projectId, 'folder_scope_mismatch');
  if (!allowRevoked) ensure(source.grantState === 'active', 'folder_permission_revoked');
  return source;
}
export function findFolderResource(db: DatabaseSync, projectId: string | null, source: FolderSource): string | null {
  sourceValid(source); ensure(validProject(projectId), 'invalid_folder_request'); assertCurrentFolderSourceSync(source);
  const row = db.prepare("SELECT resource_id FROM folder_sources WHERE project_id IS ? AND path_key=? AND source_identity=? AND grant_state='active' ORDER BY resource_id LIMIT 1")
    .get(projectId, key(source.path), source.identity);
  return row ? String(row.resource_id) : null;
}
export function storeFolderSource(db: DatabaseSync, input: { resourceId: string; projectId: string | null; source: FolderSource }): void {
  ensure(db.isTransaction, 'folder_source_storage_unavailable');
  ensure(validId(input.resourceId) && validProject(input.projectId), 'invalid_folder_request');
  assertCurrentFolderSourceSync(input.source, true);
  const previous = readFolderSource(db, input.resourceId);
  ensure(!previous, 'folder_resource_already_bound');
  db.prepare('INSERT INTO folder_sources(resource_id,project_id,path_key,selected_path,source_identity,metadata_json,source_grant_id,grant_state,grant_scope,private_root) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(input.resourceId, input.projectId, key(input.source.path), input.source.path, input.source.identity, JSON.stringify(input.source.metadata), input.source.sourceGrantId, 'active', 'metadata-only', input.source.privateRoot);
}
export function revokeFolderSource(db: DatabaseSync, resourceId: string): void {
  ensure(db.isTransaction && validId(resourceId), 'folder_source_storage_unavailable');
  db.prepare("UPDATE folder_sources SET grant_state='revoked' WHERE resource_id=?").run(resourceId);
}
/** A native gesture handler consumes this path privately. It is not a renderer/model command. */
export async function folderExternalTarget(db: DatabaseSync, resourceId: string, projectId: string | null, privateRoot?: string): Promise<string> {
  const source = scoped(db, resourceId, projectId); await assertCurrentFolderSource(source, privateRoot);
  ensure(scoped(db, resourceId, projectId).sourceGrantId === source.sourceGrantId, 'folder_permission_revoked'); return source.path;
}
/** Reuse identifies a source only; a separate explicit discovery purpose still governs child inspection/import. */
export const folderDiscoveryRoot = folderExternalTarget;

interface EntryLease { resourceId: string; projectId: string | null; grantId: string; absolute: string; identity: string; kind: FolderEntry['kind']; expires: number }
interface Listing { id: string; resourceId: string; projectId: string | null; grantId: string; absolute: string; identity: string; revision: string; entryId: string | null; names: string[]; truncated: boolean; expires: number }
interface Cursor { listing: string; offset: number; expires: number }
export interface FolderSourcesOptions { privateRoot?: string; now?: () => number; pageSize?: number; maxEntries?: number; leaseMs?: number; timeoutMs?: number }
export class FolderSources {
  private readonly db: DatabaseSync; private readonly options: FolderSourcesOptions; private readonly now: () => number;
  private readonly pageSize: number; private readonly maxEntries: number; private readonly leaseMs: number; private readonly timeoutMs: number;
  private closed = false; private busy = false;
  private readonly entries = new Map<string, EntryLease>(); private readonly listings = new Map<string, Listing>(); private readonly cursors = new Map<string, Cursor>();
  static migrate(db: DatabaseSync) {
    ensure(db.isTransaction, 'folder_source_storage_unavailable');
    db.exec(`CREATE TABLE IF NOT EXISTS folder_sources(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
      project_id TEXT,path_key TEXT NOT NULL,selected_path TEXT NOT NULL,source_identity TEXT NOT NULL,metadata_json TEXT NOT NULL,
      source_grant_id TEXT NOT NULL,grant_state TEXT NOT NULL CHECK(grant_state IN('active','revoked')),
      grant_scope TEXT NOT NULL CHECK(grant_scope='metadata-only'),private_root TEXT);
      CREATE INDEX IF NOT EXISTS folder_sources_identity ON folder_sources(project_id,path_key,source_identity);`);
  }
  constructor(db: DatabaseSync, options: FolderSourcesOptions = {}) {
    this.db = db; this.options = { ...options }; this.now = options.now ?? (() => performance.now());
    const limit = (v: number | undefined, max: number) => { const n = v ?? max; ensure(Number.isSafeInteger(n) && n >= 1 && n <= max, 'invalid_folder_request'); return n; };
    this.pageSize = limit(options.pageSize, FOLDER_LIMITS.pageSize); this.maxEntries = limit(options.maxEntries, FOLDER_LIMITS.entries);
    this.leaseMs = limit(options.leaseMs, FOLDER_LIMITS.leaseMs); this.timeoutMs = limit(options.timeoutMs, FOLDER_LIMITS.timeoutMs);
  }
  private prune() {
    const now = this.now();
    for (const map of [this.entries, this.listings, this.cursors]) for (const [id, lease] of map) if (lease.expires <= now) map.delete(id);
  }
  private async run<T>(work: (check: () => void) => Promise<T>): Promise<T> {
    ensure(!this.closed, 'folder_source_unavailable'); ensure(!this.busy, 'folder_listing_busy'); this.busy = true; this.prune();
    let expired = false; let timer: ReturnType<typeof setTimeout>;
    const check = () => { ensure(!this.closed, 'folder_source_unavailable'); ensure(!expired, 'folder_listing_timeout'); };
    const task = work(check).finally(() => { clearTimeout(timer); this.busy = false; });
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new ServiceError('folder_listing_timeout')); }, this.timeoutMs); });
    return Promise.race([task, timeout]);
  }
  private entry(source: StoredFolderSource, id: string) {
    ensure(typeof id === 'string' && /^fentry-[a-f0-9-]{36}$/u.test(id), 'invalid_folder_request');
    const lease = this.entries.get(id); ensure(lease && lease.expires > this.now(), 'folder_listing_expired');
    ensure(lease.resourceId === source.resourceId && lease.projectId === source.projectId && lease.grantId === source.sourceGrantId, 'folder_scope_mismatch');
    ensure(lease.kind === 'folder', 'folder_entry_not_directory'); return lease;
  }
  private async directory(source: StoredFolderSource, entryId?: string) {
    await assertCurrentFolderSource(source, this.options.privateRoot);
    if (!entryId) return { absolute: source.path, identity: source.identity };
    const lease = this.entry(source, entryId); ensure(within(source.path, lease.absolute), 'folder_source_restricted');
    denied(lease.absolute, [source.privateRoot, await exclusion(this.options.privateRoot)]); await noLinks(lease.absolute);
    ensure(same(await realpath(lease.absolute), lease.absolute), 'folder_source_changed');
    const stat = await lstat(lease.absolute, { bigint: true }); ensure(stat.isDirectory() && !stat.isSymbolicLink() && identity(stat) === lease.identity, 'folder_source_changed');
    return { absolute: lease.absolute, identity: lease.identity };
  }
  async describe(resourceId: string, projectId: string | null): Promise<FolderDescription> {
    ensure(!this.closed, 'folder_source_unavailable'); const source = scoped(this.db, resourceId, projectId, true);
    let accessState: FolderDescription['accessState'] = source.grantState === 'revoked' ? 'revoked' : 'available';
    if (accessState === 'available') try { await this.run(async check => { await assertCurrentFolderSource(source, this.options.privateRoot); check(); }); }
    catch (e) { accessState = (e as ServiceError).code === 'folder_source_changed' || (e as ServiceError).code === 'folder_source_restricted' ? 'changed' : 'unavailable'; }
    return { resourceId, metadata: structuredClone(source.metadata), accessState, capabilities: { list: accessState === 'available', openExternal: accessState === 'available' } };
  }
  async list(input: FolderBrowseRequest, projectId: string | null): Promise<FolderBrowseResponse> {
    ensure(input && Object.keys(input).every(k => ['resourceId', 'entryId', 'cursor'].includes(k)) && validId(input.resourceId) &&
      (input.entryId === undefined || typeof input.entryId === 'string') && (input.cursor === undefined || typeof input.cursor === 'string'), 'invalid_folder_request');
    return this.run<FolderBrowseResponse>(async check => {
      const source = scoped(this.db, input.resourceId, projectId); const directory = await this.directory(source, input.entryId); check();
      let listing: Listing; let offset = 0;
      if (input.cursor) {
        ensure(/^fcursor-[a-f0-9-]{36}$/u.test(input.cursor), 'invalid_folder_request'); const cursor = this.cursors.get(input.cursor);
        ensure(cursor && cursor.expires > this.now(), 'folder_listing_expired'); const found = this.listings.get(cursor.listing); ensure(found && found.expires > this.now(), 'folder_listing_expired');
        listing = found; offset = cursor.offset;
        ensure(listing.resourceId === source.resourceId && listing.projectId === projectId && listing.grantId === source.sourceGrantId && listing.entryId === (input.entryId ?? null), 'folder_scope_mismatch');
      } else {
        const before = await lstat(directory.absolute, { bigint: true }); check();
        const names: string[] = []; let truncated = false; const dir = await opendir(directory.absolute, { bufferSize: 32 });
        try { for await (const entry of dir) { check(); if (names.length >= this.maxEntries) { truncated = true; break; } names.push(entry.name); } }
        finally { await dir.close().catch(() => {}); }
        check(); const after = await lstat(directory.absolute, { bigint: true }); check();
        ensure(identity(after) === directory.identity && revision(before) === revision(after), 'folder_listing_changed'); names.sort((a, b) => a.localeCompare(b));
        listing = { id: randomUUID(), resourceId: source.resourceId, projectId, grantId: source.sourceGrantId, absolute: directory.absolute, identity: directory.identity,
          revision: revision(after), entryId: input.entryId ?? null, names, truncated, expires: this.now() + this.leaseMs };
        while (this.listings.size >= FOLDER_LIMITS.snapshots) this.listings.delete(this.listings.keys().next().value!); this.listings.set(listing.id, listing);
      }
      const current = await lstat(listing.absolute, { bigint: true }); check();
      ensure(identity(current) === listing.identity && revision(current) === listing.revision, 'folder_listing_changed');
      const entries: FolderEntry[] = []; const end = Math.min(offset + this.pageSize, listing.names.length); const roots = [source.privateRoot, await exclusion(this.options.privateRoot)];
      for (const name of listing.names.slice(offset, end)) {
        const absolute = path.join(listing.absolute, name); ensure(within(source.path, absolute), 'folder_source_restricted');
        if (roots.some(root => root && within(root, absolute))) continue;
        const stat = await lstat(absolute, { bigint: true }); check();
        const kind = stat.isSymbolicLink() ? 'unsupported' : stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : 'unsupported';
        const id = 'fentry-' + randomUUID(); while (this.entries.size >= FOLDER_LIMITS.leases) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(id, { resourceId: source.resourceId, projectId, grantId: source.sourceGrantId, absolute, identity: identity(stat), kind, expires: listing.expires });
        entries.push({ id, name: display(name), kind, sourceRevision: revision(stat), ...(kind === 'file' && stat.size <= BigInt(Number.MAX_SAFE_INTEGER) ? { byteLength: Number(stat.size) } : {}) });
      }
      const final = await lstat(listing.absolute, { bigint: true }); check();
      ensure(identity(final) === listing.identity && revision(final) === listing.revision, 'folder_listing_changed');
      await noLinks(listing.absolute); ensure(same(await realpath(listing.absolute), listing.absolute), 'folder_source_changed'); check();
      ensure(scoped(this.db, source.resourceId, projectId).sourceGrantId === source.sourceGrantId, 'folder_permission_revoked');
      let cursor: string | null = null;
      if (end < listing.names.length) { cursor = 'fcursor-' + randomUUID(); while (this.cursors.size >= FOLDER_LIMITS.leases) this.cursors.delete(this.cursors.keys().next().value!); this.cursors.set(cursor, { listing: listing.id, offset: end, expires: listing.expires }); }
      return { resourceId: source.resourceId, entryId: listing.entryId, name: display(path.basename(listing.absolute)), entries, cursor, truncated: listing.truncated,
        observedRevision: listing.revision, scope: 'metadata-only' };
    }).catch(safeError);
  }
  async externalTarget(resourceId: string, projectId: string | null, entryId?: string): Promise<string> {
    return this.run(async check => { const source = scoped(this.db, resourceId, projectId); const directory = await this.directory(source, entryId); check();
      ensure(scoped(this.db, resourceId, projectId).sourceGrantId === source.sourceGrantId, 'folder_permission_revoked'); return directory.absolute; }).catch(safeError);
  }
  dispose(): void { this.closed = true; this.entries.clear(); this.listings.clear(); this.cursors.clear(); }
}
