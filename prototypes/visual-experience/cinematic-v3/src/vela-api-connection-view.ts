import type { ApiModelCatalog, RedactedApiConnectionView } from '../../../openai-provider/api-connection-contracts.mts';
import type { VelaApiUsageStatus } from '../../../integrated-backend/src/vela-api-runtime.mts';

export type VelaApiControlRequest = { type: 'status' | 'setup' | 'usageStatus' } | { type: 'catalog' | 'disconnect'; expectedVersion: number } | { type: 'authorizeUsage'; expectedVersion: number; enabled: boolean };
export type VelaApiControl = (input: VelaApiControlRequest) => Promise<RedactedApiConnectionView | ApiModelCatalog | VelaApiUsageStatus>;

/** Status and native setup launch only. No key field exists in this renderer. */
export function mountVelaApiConnection(root: HTMLElement, command: VelaApiControl) {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const element = document.createElement(tag); element.textContent = text; return element;
  };
  const section = node('section'), heading = node('h3', 'Vela OpenAI API'),
    status = node('p', 'Checking Vela API connection…'),
    boundary = node('p', 'API usage is billed separately from ChatGPT. Saving a key does not start inference or voice.'),
    actions = node('div'), setup = node('button', 'Set up API connection'),
    catalog = node('button', 'Discover API models'), disconnect = node('button', 'Disconnect API'),
    models = node('p'), usageLabel = node('p'), usage = node('button','Enable Vela API usage');
  section.dataset.velaApiConnection = 'true'; actions.className = 'connection-actions';
  boundary.className = 'connection-boundary'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  for (const [button, action] of [[setup, 'setup'], [catalog, 'catalog'], [disconnect, 'disconnect']] as const) {
    button.type = 'button'; button.dataset.velaApiAction = action; button.dataset.aerynthMotionControl = 'true';
  }
  usage.type = 'button'; usage.dataset.velaApiAction = 'usage'; usage.dataset.aerynthMotionControl = 'true';
  actions.append(setup, catalog, disconnect, usage); section.append(heading, status, boundary, actions, models, usageLabel); root.append(section);
  let current: RedactedApiConnectionView | null = null, busy = false, disposed = false, revision = 0, failed = false;
  let usageState: VelaApiUsageStatus | null = null;
  function currentUsage() {
    return current?.version != null && usageState?.configurationVersion === current.version ? usageState : null;
  }
  function paint() {
    if (disposed) return;
    section.dataset.apiConnectionState = current?.state ?? 'unknown';
    setup.disabled = busy || current?.storageAvailable !== true;
    catalog.disabled = busy || current?.state !== 'configured' || current?.version == null;
    disconnect.disabled = busy || current?.version == null || !current.configured;
    usage.disabled = busy || current?.version == null || !current.configured || !current.storageAvailable;
    const authorization = currentUsage();
    const authorized = authorization?.enabled === true;
    usage.textContent = authorized ? 'Disable Vela API usage' : 'Enable Vela API usage';
    usageLabel.textContent = authorized
      ? `Vela can send eligible requests with this API key without asking again. Requests with new sources or permissions still require review. ${authorization.usedToday} of ${authorization.requestsPerDay} daily requests used; up to ${authorization.maxOutputTokens} output tokens per request. API charges apply.`
      : 'Vela API usage is disabled. Enabling allows eligible requests without a separate approval each time. API charges apply: up to 64 requests per day and 2,048 output tokens per request. No request starts just by enabling.';
    setup.textContent = current?.configured ? 'Replace API connection' : 'Set up API connection';
    if (failed) status.textContent = 'The Vela API connection could not be updated. Check the connection and try again.';
    else if (busy) status.textContent = 'Updating Vela API connection…';
    else if (!current) status.textContent = 'Checking Vela API connection…';
    else status.textContent = current.state === 'configured'
      ? 'Vela API key saved securely. Model access is checked per request.'
      : current.state === 'disconnected' ? 'No Vela API key is saved.' : 'Protected API credential storage is unavailable.';
    models.textContent = current?.catalog.state === 'ready' ? `${current.catalog.modelCount} ${current.catalog.modelCount === 1 ? 'model' : 'models'} listed. Access varies by model.`
      : current?.catalog.state === 'stale' ? 'The model catalog expired. Discover models again before selecting one.'
      : current?.catalog.state === 'unavailable' ? 'API model discovery is unavailable. You can try Discover API models again.' : '';
  }
  async function refresh() {
    const stamp = ++revision;
    try {
      const value = await command({ type: 'status' });
      if (disposed || stamp !== revision) return;
      if (!('configured' in value)) throw Error('api_status_invalid');
      current = value; failed = false;
      const usageValue = await command({ type: 'usageStatus' });
      if (disposed || stamp !== revision) return;
      if (!('enabled' in usageValue)) throw Error('api_usage_status_invalid'); usageState = usageValue;
    } catch { if (!disposed && stamp === revision) failed = true; }
    paint();
  }
  async function run(type: 'setup' | 'catalog' | 'disconnect') {
    if (disposed || busy || type !== 'setup' && current?.version == null) return;
    busy = true; failed = false; paint();
    const stamp = ++revision;
    try {
      // Dispatch synchronously from the click; native code observes the actual gesture.
      const value = await command(type === 'setup' ? { type } : { type, expectedVersion: current!.version! });
      if (disposed || stamp !== revision) return;
      if ('configured' in value) current = value;
      await refresh();
    } catch { if (!disposed && stamp === revision) failed = true; }
    finally { busy = false; paint(); }
  }
  setup.onclick = () => { if (!setup.disabled) void run('setup'); };
  catalog.onclick = () => { if (!catalog.disabled) void run('catalog'); };
  disconnect.onclick = () => { if (!disconnect.disabled) void run('disconnect'); };
  usage.onclick = () => {
    if (disposed || busy || usage.disabled || current?.version == null) return;
    busy = true; failed = false; paint();
    void command({type:'authorizeUsage',expectedVersion:current.version,enabled:currentUsage()?.enabled !== true}).then(value => {
      if (!disposed && 'enabled' in value) usageState = value;
    }, () => { if (!disposed) failed = true; }).finally(() => { busy = false; paint(); });
  };
  paint();
  return { ready: refresh(), refresh, dispose() { disposed = true; revision++; setup.onclick = catalog.onclick = disconnect.onclick = usage.onclick = null; } };
}
