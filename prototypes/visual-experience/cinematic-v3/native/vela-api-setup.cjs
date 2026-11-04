const { randomUUID } = require('node:crypto');
const path = require('node:path');
const CHANNEL = 'vela-api-setup';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const safeCodes = new Set(['api_configuration_changed', 'api_configuration_invalid', 'api_configuration_limit',
  'api_secret_unavailable', 'api_secret_invalid', 'api_storage_unavailable', 'storage_reserve_admission_denied']);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'"><title>Vela API connection</title><style>
:root{color-scheme:dark;font:15px/1.5 system-ui;color:#eee8fa;background:#0c0d17}*{box-sizing:border-box}body{margin:0;padding:24px}h1{font-size:23px;margin:0 0 8px}p{color:#c5bdd2}form,label{display:grid;gap:7px}form{gap:14px}input{font:inherit;padding:9px 12px;border:1px solid #bda8df55;border-radius:10px;background:#bda8df0b;color:inherit}input:focus-visible,button:focus-visible{outline:2px solid #d3b7fa;outline-offset:3px}button{font:inherit;border:1px solid #c6bce744;border-radius:10px;color:inherit;background:#b59ae71a;padding:9px 16px;cursor:pointer}footer{display:flex;justify-content:end;gap:10px;margin-top:12px}small{color:#b8afc7}#status{min-height:24px}input:disabled,button:disabled{opacity:.55}
</style></head><body><h1>Vela API connection</h1><p>Save your OpenAI API key in this device’s protected storage. API usage is billed separately from ChatGPT.</p><form id="configuration" autocomplete="off"><label>API key<input id="api-key" type="password" autocomplete="off" spellcheck="false" maxlength="4096" required></label><label>Organization (optional)<input id="organization" autocomplete="off" spellcheck="false" maxlength="200"></label><label>Project (optional)<input id="project" autocomplete="off" spellcheck="false" maxlength="200"></label><small>Saving a key does not start inference or voice. Model discovery does not verify billing or access to a model.</small><p id="status" role="status" aria-live="polite"></p><footer><button id="cancel" type="button">Cancel</button><button id="save" type="submit">Save connection</button></footer></form></body></html>`;

/** Native credential entry only. The ordinary application renderer never receives a key or this channel. */
function createVelaApiSetup({ BrowserWindow, ipcMain, storageAllowed, status, configure, timeoutMs = 300000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw Error('api_setup_invalid_timeout');
  let active = null, disposed = false, opening = null, openingOwner = null;
  const openOwned = async owner => {
    if (disposed) throw Error('api_setup_closed');
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed() || !owner.isVisible() || !owner.isFocused())
      throw Error('api_setup_owner_unavailable');
    if (active) {
      if (active.owner !== owner) throw Error('api_setup_owner_unavailable');
      active.child.show(); active.child.focus(); return active.result;
    }
    const before = await status();
    if (disposed || owner.isDestroyed() || owner.webContents.isDestroyed() || !owner.isVisible() || !owner.isFocused())
      throw Error('api_setup_owner_unavailable');
    if (!before?.storageAvailable) throw Error('api_secret_unavailable');
    const token = randomUUID(), url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    const child = new BrowserWindow({ parent: owner, modal: true, show: false, width: 520, height: 610,
      minWidth: 420, minHeight: 560, title: 'Vela API connection', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'vela-api-setup-preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false,
        partition: 'vela-api-setup-' + token, additionalArguments: ['--vela-api-setup-token=' + token] } });
    child.removeMenu?.();
    let done = false, ready = false, shown = false, saving = false, resolve;
    const result = new Promise(accept => { resolve = accept; });
    const listeners = [];
    const listen = (emitter, name, handler) => { emitter.on(name, handler); listeners.push([emitter, name, handler]); };
    const finish = value => {
      if (done) return; done = true; clearTimeout(timer);
      for (const [emitter, name, handler] of listeners) emitter.removeListener(name, handler);
      if (active?.child === child) active = null;
      if (!child.isDestroyed()) child.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ saved: false }), timeoutMs); timer.unref?.();
    active = { child, owner, result, finish };
    const valid = event => !done && !child.isDestroyed() && !child.webContents.isDestroyed() &&
      event.sender === child.webContents && event.senderFrame === child.webContents.mainFrame && event.senderFrame.url === url;
    const owned = event => valid(event) && !owner.isDestroyed() && !owner.webContents.isDestroyed() &&
      child.getParentWindow() === owner && child.isVisible() && child.isFocused();
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.session?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
    child.webContents.session?.setPermissionCheckHandler?.(() => false);
    listen(owner, 'closed', () => finish({ saved: false }));
    listen(child, 'closed', () => finish({ saved: false }));
    listen(child.webContents, 'render-process-gone', () => finish({ saved: false }));
    listen(child.webContents, 'preload-error', () => finish({ saved: false }));
    listen(child.webContents, 'will-navigate', event => event.preventDefault());
    const show = () => { if (done || !ready || !shown) return; child.show(); child.focus(); };
    listen(child, 'ready-to-show', () => { shown = true; show(); });
    listen(ipcMain, CHANNEL, (event, input) => {
      if (!valid(event) || !input || input.token !== token) return;
      if (exact(input, ['token', 'action']) && input.action === 'ready') { ready = true; show(); return; }
      if (!owned(event) || !ready || !shown || saving) return;
      if (exact(input, ['token', 'action']) && input.action === 'cancel') { finish({ saved: false }); return; }
      if (!exact(input, ['token', 'action', 'apiKey', 'organization', 'project']) || input.action !== 'save' ||
          typeof input.apiKey !== 'string' || input.apiKey.length < 16 || input.apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/u.test(input.apiKey) ||
          ![input.organization, input.project].every(value => typeof value === 'string' && (!value || /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(value)))) return;
      saving = true;
      const credential = { configurationId: before.configurationId, apiKey: input.apiKey,
        ...(input.organization ? { organization: input.organization } : {}), ...(input.project ? { project: input.project } : {}) };
      input.apiKey = '';
      void (async () => {
        try {
          const activated = await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()', false).catch(() => false);
          if (!activated || !owned(event) || !await storageAllowed() || !owned(event)) throw Error('api_setup_save_denied');
          const current = await configure(credential, before.version);
          if (current?.configurationId !== before.configurationId || current?.configured !== true || current?.state !== 'configured' ||
              current?.storageAvailable !== true || current?.version !== (before.version ?? 0) + 1) throw Error('api_setup_save_failed');
          if (!done) finish({ saved: true });
        } catch (error) {
          if (!done && valid(event)) child.webContents.send(CHANNEL + '-result', {
            token, errorCode: safeCodes.has(error?.message) ? error.message : 'api_setup_save_failed' });
        } finally { credential.apiKey = ''; saving = false; }
      })();
    });
    try { await child.loadURL(url); } catch { finish({ saved: false }); }
    return result;
  };
  return {
    open(owner) {
      if (opening) return openingOwner === owner ? opening : Promise.reject(Error('api_setup_owner_unavailable'));
      openingOwner = owner;
      const task = openOwned(owner); opening = task;
      void task.finally(() => { if (opening === task) { opening = null; openingOwner = null; } }).catch(() => {});
      return task;
    },
    close() { disposed = true; active?.finish({ saved: false }); },
  };
}
exports.createVelaApiSetup = createVelaApiSetup;
exports.apiSetupPage = html;
