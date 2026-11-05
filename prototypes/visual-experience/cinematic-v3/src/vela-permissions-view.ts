interface WeatherPermission {
  purpose: 'approximate-location:nws-weather';
  decision: 'unknown' | 'allow' | 'deny';
  version: number;
}
type PermissionRequest = { type: 'status' | 'windows-settings' } | { type: 'change'; expectedVersion: number };

/** Permission choice only. Coordinates are never part of this view or its saved state. */
export function createVelaPermissionsView(doc: Document, command: (request: PermissionRequest) => Promise<unknown>) {
  const element = doc.createElement('section'); element.setAttribute('aria-label', 'Weather location permission');
  const title = doc.createElement('h3'); title.textContent = 'Weather location';
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const detail = doc.createElement('p'); detail.className = 'vela-core-meta';
  detail.textContent = 'Each weather question requests a fresh Windows location. Only an approximate point is sent to the weather service. Your location is not saved.';
  const change = doc.createElement('button'); change.type = 'button'; change.className = 'vela-core-button'; change.textContent = 'Change permission';
  const windows = doc.createElement('button'); windows.type = 'button'; windows.className = 'vela-core-button'; windows.textContent = 'Windows location settings';
  element.append(title, status, detail, change, windows);
  let value: WeatherPermission | null = null, busy = false, visible = false, disposed = false, revision = 0;
  function render() { change.disabled = busy || !value; windows.disabled = busy; }
  function accept(result: unknown) {
    const next = result as WeatherPermission;
    if (!next || next.purpose !== 'approximate-location:nws-weather' || !['unknown', 'allow', 'deny'].includes(next.decision) || !Number.isSafeInteger(next.version)) throw Error('invalid_permission_status');
    value = next;
    status.textContent = next.decision === 'allow' ? 'Allowed for weather. Windows permission is managed separately.' : next.decision === 'deny' ? 'Weather location is off.' : 'You haven’t chosen a weather location permission yet.';
  }
  async function run(request: PermissionRequest) {
    if (busy || disposed) return;
    const sequence = ++revision; busy = true; render();
    try {
      // Invoke synchronously while a button's native activation is still current.
      const pending = command(request); const result = await pending;
      if (!disposed && sequence === revision) accept(result);
    } catch { if (!disposed && sequence === revision) status.textContent = 'Couldn’t update location permission. Reopen these settings to retry.'; }
    finally { if (!disposed && sequence === revision) { busy = false; render(); } }
  }
  change.addEventListener('click', () => { if (value && !change.disabled) void run({ type: 'change', expectedVersion: value.version }); });
  windows.addEventListener('click', () => { if (!windows.disabled) void run({ type: 'windows-settings' }); });
  render();
  return { element, setVisible(next: boolean) { if (disposed) return; const opened = next && !visible; visible = next; if (opened) void run({ type: 'status' }); },
    dispose() { disposed = true; revision++; } };
}
