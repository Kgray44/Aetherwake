const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const CONFIGURATION = 'vela-primary';
const entropy = 'Aerynth.VelaAPI.bootstrap@1';
// The protected blob path and entropy are native constants. No key enters a process argument.
const decryptScript = `Add-Type -AssemblyName System.Security;$p=Join-Path $env:LOCALAPPDATA 'Aerynth\\private-vela-credentials\\vela-primary.bootstrap.dpapi';$c=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($c))}finally{[Array]::Clear($c,0,$c.Length)}`;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function decrypt(run = execFile) {
  return new Promise((resolve, reject) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', decryptScript],
    { windowsHide: true, timeout: 10000, maxBuffer: 16384 }, (error, stdout) => {
      if (error || typeof stdout !== 'string' || Buffer.byteLength(stdout) > 16384) return reject(Error('api_bootstrap_unavailable'));
      try {
        const value = JSON.parse(stdout);
        if (!exact(value, ['configurationId', 'apiKey', 'version']) || value.configurationId !== CONFIGURATION || value.version !== 1 ||
            typeof value.apiKey !== 'string' || value.apiKey.length < 16 || value.apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/u.test(value.apiKey))
          throw Error('invalid');
        resolve({ configurationId: CONFIGURATION, apiKey: value.apiKey });
      } catch { reject(Error('api_bootstrap_invalid')); }
    }));
}

/** Explicit native launch flag only. The source is a CurrentUser-DPAPI blob supplied by the owner. */
async function importVelaApiBootstrap({ call, storageAllowed, localAppData = process.env.LOCALAPPDATA, profileDirectory, run = execFile }) {
  if (!localAppData || !path.isAbsolute(localAppData)) throw Error('api_bootstrap_unavailable');
  const directory = path.join(localAppData, 'Aerynth', 'private-vela-credentials');
  if (profileDirectory !== undefined && (!path.isAbsolute(profileDirectory) || !await fs.stat(profileDirectory).then(info => info.isDirectory()).catch(() => false)))
    throw Error('api_bootstrap_unavailable');
  const source = path.join(directory, 'vela-primary.bootstrap.dpapi'), receiptPath = path.join(profileDirectory ?? directory, 'vela-primary.import.json');
  const sourceInfo = await fs.lstat(source).catch(() => null);
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size < 1 || sourceInfo.size > 32768) throw Error('api_bootstrap_unavailable');
  const digest = createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const before = await call('velaApiConnection', { type: 'status' });
  if (before?.configurationId !== CONFIGURATION || before?.storageAvailable !== true) throw Error('api_secret_unavailable');
  let imported;
  try { const value = await fs.readFile(receiptPath, 'utf8'); if (value.length <= 4096) imported = JSON.parse(value); } catch {}
  if (!await storageAllowed()) throw Error('storage_reserve_admission_denied');
  if (imported?.digest === digest && imported.version === before.version && before.configured) {
    await call('velaApiUsageAuthorize', { expectedVersion: before.version, enabled: true });
    return { imported: false, configured: true, version: before.version };
  }
  if (imported && (imported.digest !== digest || imported.version !== before.version)) throw Error('api_bootstrap_connection_changed');
  const credential = await decrypt(run);
  try {
    const result = await call('velaApiConfigure', { credential, expectedVersion: before.version });
    if (!result?.configured || result.state !== 'configured' || result.configurationId !== CONFIGURATION ||
        result.version !== (before.version ?? 0) + 1) throw Error('api_bootstrap_unconfirmed');
    await fs.writeFile(receiptPath, JSON.stringify({ contract: 'aerynth.vela-api-import@1', digest, version: result.version }), { flag: 'w' });
    await call('velaApiUsageAuthorize', { expectedVersion: result.version, enabled: true });
    return { imported: true, configured: true, version: result.version };
  } finally { credential.apiKey = ''; }
}
exports.importVelaApiBootstrap = importVelaApiBootstrap;
