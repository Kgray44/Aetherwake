const { app, BrowserWindow, ipcMain, session, dialog, nativeTheme } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { mkdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const verify = process.argv.includes('--integration-verify');
const profileArg = process.argv.find(a => a.startsWith('--profile='));
const privateRoot = profileArg ? path.resolve(profileArg.slice(10)) : path.join(app.getPath('appData'), 'Aerynth', 'review');
let admitted = false;
function reserveGuard() {
  if (process.platform !== 'win32') return true;
  try {
    const guard = path.join(app.getPath('home'), 'AppData/Local/AeroStorageWatch/ReserveGuard.ps1');
    const receipt = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', guard, '-EstimatedCBytes', '1073741824', '-EstimatedDBytes', privateRoot.toUpperCase().startsWith('D:') ? '536870912' : '0'], { windowsHide: true, encoding: 'utf8', timeout: 15000 }));
    return receipt.allowed === true;
  } catch { return false; }
}
admitted = reserveGuard();
if (!admitted) { console.error('storage_reserve_admission_denied'); app.exit(1); }
mkdirSync(privateRoot, { recursive: true });
app.commandLine.appendSwitch('disk-cache-size', '33554432');
app.setPath('userData', path.join(privateRoot, 'chromium'));
app.setAppUserModelId('org.aetherwake.aerynth.review');
let win, child, serial = 0, closing = false;
const pending = new Map();
function call(command, input) {
  if (!child || child.killed || !child.stdin.writable) return Promise.reject(new Error('backend_disconnected'));
  if (pending.size >= 64) return Promise.reject(new Error('backpressure'));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(command === 'execute' ? 'unknown_execution_outcome' : 'backend_timeout')); }, 90000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, command, input }) + '\n');
  });
}
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  const localURL = pathToFileURL(path.join(root, 'dist/index.html')).href;
  child = spawn('node', [path.resolve(root, '../../integrated-backend/src/desktop-host.mts'), path.join(privateRoot, 'aerynth.sqlite'), privateRoot, root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('backend_disconnected')); } pending.clear(); win?.webContents.send('application-event', { type: 'backend/disconnected', classification: 'observed' }); };
  child.on('error', fail); child.on('exit', fail);
  // Native diagnostics may contain private paths; never forward stderr to the renderer or public evidence.
  child.stderr.on('data', () => {});
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const m = JSON.parse(line);
      if (m.event) { if (win && !win.isDestroyed()) win.webContents.send('application-event', m.event); return; }
      const p = pending.get(m.id); if (!p) return;
      clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    } catch { fail(); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, callback) => callback({ cancel: true }));
  win = new BrowserWindow({ width: 1600, height: 1000, minWidth: 800, minHeight: 650, show: true, backgroundColor: '#05060c', title: 'Aerynth · Working environment', titleBarStyle: 'hidden', titleBarOverlay: { color: '#080910', symbolColor: '#d8cee9', height: 42 }, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'desktop-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== localURL) event.preventDefault(); });
  ipcMain.handle('application-command', async (event, command, input) => {
    try {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== localURL) throw new Error('unauthorized_sender');
      if (Buffer.byteLength(JSON.stringify(input ?? {})) > 200000) throw new Error('command_too_large');
      if (!admitted && !['replay', 'executionStatus', 'interrupt'].includes(command) && !(command === 'desktop' && input?.type === 'snapshot')) throw new Error('storage_reserve_admission_denied');
      let result;
      if (command === 'desktop') result = await call('desktop', input);
      else if (command === 'capabilities') result = await call('capabilities', {});
      else if (command === 'replay') result = await call('replay', { after: 0, limit: 250 });
      else if (command === 'executionStatus') result = Object.values((await call('snapshot', {})).executions);
      else if (command === 'interrupt') result = await call('interrupt', { executionId: input.executionId });
      else if (command === 'send') {
        if (typeof input.content !== 'string' || !input.content.trim() || Buffer.byteLength(input.content) > 16000) throw new Error('invalid_message');
        const state = await call('desktop', { type: 'snapshot' });
        const resource = state.resources.find(r => r.id === input.resourceId && r.kind === 'conversation');
        if (!resource) throw new Error('resource_not_found');
        if (resource.provider === 'local') result = await call('addMessage', { resourceId: resource.id, role: 'user', content: input.content, sensitivity: 'internal', expectedRevision: input.expectedVersion });
        else {
          const response = await dialog.showMessageBox(win, { type: 'question', title: 'Authorize Codex turn', message: `Send this message to Codex in “${resource.title}”?`, detail: `Uses your configured local Codex account and native instructions. This review build requests a read-only sandbox and denies approval requests. It does not grant tool or write approvals.\n\n${input.content}`, buttons: ['Cancel', 'Send once'], defaultId: 0, cancelId: 0, noLink: true });
          if (response.response !== 1) throw new Error('authorization_cancelled');
          result = await call('execute', { resourceId: resource.id, prompt: input.content, authorized: true, commandId: randomUUID() });
        }
      } else throw new Error('unsupported_command');
      return { ok: true, result };
    } catch (e) { const message = String(e.message); return { ok: false, error: /^[a-zA-Z_-]{1,80}$/.test(message) ? message : 'operation_failed' }; }
  });
  const active = () => { if (!win.isDestroyed()) win.webContents.send('host-active', win.isVisible() && !win.isMinimized() && win.isFocused()); };
  for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.on(event, active);
  await win.loadURL(localURL);
  win.show(); win.focus(); active();
  const reserveTimer = setInterval(() => {
    admitted = reserveGuard();
    if (!admitted) {
      win.webContents.send('application-event', { type: 'storage/reserve-admission-denied', classification: 'observed' });
      call('snapshot', {}).then(snapshot => { for (const e of Object.values(snapshot.executions)) if (e.state === 'running' && e.turnId) void call('interrupt', { executionId: e.id }).catch(() => {}); }).catch(() => {});
    }
  }, 240000);
  reserveTimer.unref();
  if (verify) await require('./desktop-verify.cjs').verify({ win, app, privateRoot, call });
});
app.on('before-quit', event => {
  if (!child || closing) return;
  event.preventDefault(); closing = true;
  call('close', {}).catch(() => {}).finally(() => { child.kill(); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
