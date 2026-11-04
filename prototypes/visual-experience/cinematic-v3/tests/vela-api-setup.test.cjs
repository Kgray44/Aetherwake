const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVelaApiSetup, apiSetupPage } = require('../native/vela-api-setup.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const KEY = 'synthetic-api-key-for-offline-tests';
function fixture(options = {}) {
  const ipcMain = new EventEmitter(), windows = [], calls = [], messages = [];
  class Window extends EventEmitter {
    constructor(settings = {}) { super(); this.settings = settings; this.destroyed = false; this.visible = settings.show !== false; this.focused = true;
      this.webContents = new EventEmitter(); this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.mainFrame = { url: '', executeJavaScript: async () => options.activation !== false };
      this.webContents.setWindowOpenHandler = value => { this.openHandler = value; };
      this.webContents.session = { setPermissionRequestHandler: value => { this.permission = value; }, setPermissionCheckHandler: value => { this.permissionCheck = value; } };
      this.webContents.send = (...message) => messages.push(message); windows.push(this);
    }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isFocused() { return this.focused; }
    show() { this.visible = true; } focus() { this.focused = true; } getParentWindow() { return this.settings.parent; }
    async loadURL(url) { this.webContents.mainFrame.url = url; this.emit('ready-to-show'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const owner = new Window(), status = { configurationId: 'vela-primary', version: 7, storageAvailable: true };
  const setup = createVelaApiSetup({ BrowserWindow: Window, ipcMain, storageAllowed: async () => options.storage !== false,
    status: async () => status,
    configure: async (input, version) => { calls.push({ input: { ...input }, version }); if (options.error) throw Error(options.error);
      return { ...status, version: 8, configured: true, state: 'configured' }; } });
  const begin = async () => {
    const result = setup.open(owner); await tick();
    const child = windows[1], token = child.settings.webPreferences.additionalArguments[0].split('=')[1];
    const event = { sender: child.webContents, senderFrame: child.webContents.mainFrame };
    const send = value => ipcMain.emit('vela-api-setup', event, { token, ...value });
    send({ action: 'ready' });
    return { result, child, token, event, send };
  };
  return { setup, begin, windows, calls, messages, ipcMain, owner };
}
const save = () => ({ action: 'save', apiKey: KEY, organization: 'org-synthetic', project: 'proj-synthetic' });

test('native-only setup saves exact-version credentials and returns only the redacted status', async () => {
  const f = fixture(), view = await f.begin(); view.send(save());
  assert.deepEqual(await view.result, { saved: true });
  assert.deepEqual(f.calls, [{ input: { configurationId: 'vela-primary', apiKey: KEY, organization: 'org-synthetic', project: 'proj-synthetic' }, version: 7 }]);
  assert.equal(f.ipcMain.listenerCount('vela-api-setup'), 0); assert.equal(view.child.destroyed, true);
  assert.equal(view.child.settings.webPreferences.nodeIntegration, false); assert.equal(view.child.settings.webPreferences.sandbox, true);
  assert.equal(view.child.settings.webPreferences.devTools, false); assert.equal(view.child.settings.webPreferences.partition.startsWith('persist:'), false);
  assert.deepEqual(view.child.openHandler(), { action: 'deny' }); assert.equal(view.child.permissionCheck(), false);
  assert.doesNotMatch(JSON.stringify(f.messages), new RegExp(KEY));
});

test('forged sender, frame, token, extra fields and unfocused window cannot submit credentials', async () => {
  const f = fixture(), v = await f.begin();
  const payload = { token: v.token, ...save() };
  f.ipcMain.emit('vela-api-setup', { ...v.event, sender: f.owner.webContents }, payload);
  f.ipcMain.emit('vela-api-setup', { ...v.event, senderFrame: { ...v.event.senderFrame } }, payload);
  f.ipcMain.emit('vela-api-setup', v.event, { ...payload, token: 'forged' });
  f.ipcMain.emit('vela-api-setup', v.event, { ...payload, gesture: true });
  v.child.focused = false; v.send(save()); await tick(); assert.equal(f.calls.length, 0);
  v.child.focused = true; v.send({ action: 'cancel' }); assert.deepEqual(await v.result, { saved: false });
});

test('native activation and storage admission are required independently of a renderer claim', async () => {
  for (const options of [{ activation: false }, { storage: false }]) {
    const f = fixture(options), v = await f.begin(); v.send(save()); await tick(); await tick();
    assert.equal(f.calls.length, 0); assert.equal(f.messages.length, 1);
    assert.doesNotMatch(JSON.stringify(f.messages), new RegExp(KEY));
    f.setup.close(); assert.deepEqual(await v.result, { saved: false });
  }
});

test('configuration CAS errors are safe; close removes listeners and concurrent setup opens only one child', async () => {
  const f = fixture({ error: 'api_configuration_changed' });
  const first = f.setup.open(f.owner), second = f.setup.open(f.owner); assert.equal(first, second); await tick();
  const child = f.windows[1], token = child.settings.webPreferences.additionalArguments[0].split('=')[1];
  const event = { sender: child.webContents, senderFrame: child.webContents.mainFrame };
  f.ipcMain.emit('vela-api-setup', event, { token, action: 'ready' });
  f.ipcMain.emit('vela-api-setup', event, { token, ...save() }); await tick(); await tick();
  assert.equal(f.windows.length, 2); assert.equal(f.messages[0][1].errorCode, 'api_configuration_changed');
  f.owner.destroy(); assert.deepEqual(await first, { saved: false }); assert.equal(f.ipcMain.listenerCount('vela-api-setup'), 0);
});

test('credential page has no network/scripts/form submission and failures cannot leak arbitrary service text', async () => {
  assert.match(apiSetupPage, /connect-src 'none'/); assert.match(apiSetupPage, /script-src 'none'/); assert.match(apiSetupPage, /form-action 'none'/);
  assert.match(apiSetupPage, /type="password"/); assert.match(apiSetupPage, /API usage is billed separately/);
  const f = fixture({ error: KEY }), v = await f.begin(); v.send(save()); await tick(); await tick();
  assert.equal(f.messages[0][1].errorCode, 'api_setup_save_failed'); assert.doesNotMatch(JSON.stringify(f.messages), new RegExp(KEY));
  f.setup.close(); await v.result;
});
