import type { ResourcePolicyNativeView } from '../../../integrated-backend/src/resource-policy.mts';

export type ResourcePolicyPort = {
  (action: 'inspect'): Promise<ResourcePolicyNativeView>;
  (action: 'mode' | 'rollback'): Promise<void>;
};

const resourceClasses = [
  ['cpu', 'Local CPU'], ['build', 'Build'], ['host_io', 'Host I/O'],
  ['gpu', 'Local GPU'], ['remote', 'Remote requests'],
] as const;
const modes = { balanced: 'Balanced', gaming_focus: 'Foreground / Gaming', max_throughput: 'High Throughput' };
const gib = (bytes: number | null) => bytes !== null && Number.isFinite(bytes) ? (bytes / 2 ** 30).toFixed(2) + ' GiB' : 'Unavailable';
const observed = <T extends { ageMs: number }>(sample: T | null, format: (sample: T) => string) =>
  sample ? format(sample) + ' · ' + Math.ceil(sample.ageMs / 1000) + ' s old at read' : 'Unavailable';
const reason = (code: string) => code.replaceAll('_', ' ');

export function mountResourcePolicy(doc: Document, port: ResourcePolicyPort) {
  const region = doc.createElement('section');
  region.setAttribute('aria-label', 'Current resource policy');
  region.hidden = true;
  const heading = doc.createElement('h5');
  heading.textContent = 'Current resource policy';
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const fields = doc.createElement('dl');
  const controls = doc.createElement('div');
  const button = (label: string) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = label;
    controls.append(element);
    return element;
  };
  const refresh = button('Refresh policy');
  const change = button('Review resource profile…');
  const rollback = button('Review rollback…');
  region.append(heading, status, controls, fields);
  let epoch = 0, busy = false;
  function clear() {
    epoch++;
    region.hidden = true;
    fields.replaceChildren();
    change.disabled = rollback.disabled = true;
  }
  function render(view: ResourcePolicyNativeView) {
    const rows = [
      ['Profile', modes[view.mode] + ' · ' + view.origin],
      ['Policy reason', reason(view.reason)],
      ['Policy epoch / revision', view.epoch + ' / ' + view.revision],
      ['Configuration version', view.configVersion],
      ['Last saved preference', view.appliedAtUtc ?? 'Default or host preset'],
      ['Configuration health', view.configurationHealth === 'valid' ? 'Valid' : 'Fallback settings active'],
      ['Remaining RAM for reservations', gib(view.remainingRamReservationBytes)],
      ['Supplemental Windows counters', !view.windowsCountersSupported ? 'Unsupported' : view.windowsMonitoring ? 'Enabled' : 'Disabled'],
      ['Estimated dedicated VRAM headroom', observed(view.dedicatedVramEstimate, sample => gib(sample.bytes))],
      ['Windows commit headroom', observed(view.windowsCommitHeadroom, sample => gib(sample.bytes))],
      ['Windows low memory', observed(view.windowsLowMemory, sample => sample.active ? 'Active' : 'Clear')],
      ['NVIDIA GPU thermals', observed(view.nvidiaGpuThermals, sample =>
        (sample.temperatureCelsius === null ? 'Temperature unavailable' : sample.temperatureCelsius.toFixed(1) + ' °C') +
        ' · ' + (sample.slowdown === null ? 'Slowdown unavailable' : sample.slowdown ? 'Slowdown active' : 'Slowdown clear'))],
      ['Desktop activity protection', view.externalActivityProtection
        ? observed(view.externalDesktopActivity, sample => sample.active ? 'Recent input outside Aerynth' : 'No recent input outside Aerynth')
        : 'Disabled'],
    ];
    for (const [kind, label] of resourceClasses) {
      const prior = view.previous ? ' · previous effective ' + view.previous[kind] : '';
      rows.push([label, view.effective[kind] + ' effective / ' + view.limits[kind] + ' configured · ' + view.active[kind] + ' reserved' + prior]);
    }
    if (view.lastTransition) {
      const transition = view.lastTransition;
      rows.push(['Last effective change', reason(transition.previousReason) + ' → ' + reason(transition.reason) + ' · ' + transition.observedAtUtc]);
      rows.push(['Checkpoint requests', String(Object.values(transition.checkpointRequests).reduce((sum, count) => sum + count, 0))]);
    }
    if (view.canRollback && view.previousMode) rows.push(['Previous saved profile', modes[view.previousMode]]);
    for (const [label, reading] of rows) {
      const term = doc.createElement('dt'), value = doc.createElement('dd');
      term.textContent = String(label);
      value.textContent = String(reading);
      fields.append(term, value);
    }
    change.disabled = false;
    rollback.disabled = !view.canRollback;
  }
  async function read() {
    if (region.hidden || busy) return;
    const token = ++epoch;
    fields.replaceChildren();
    change.disabled = rollback.disabled = true;
    status.textContent = 'Reading current governor policy…';
    try {
      const policy = await port('inspect');
      if (token !== epoch) return;
      if (policy.schemaVersion !== 1) throw Error('resource_policy_schema_unavailable');
      render(policy);
      status.textContent = 'Governor snapshot · ' + new Date().toLocaleTimeString();
    } catch {
      if (token === epoch) status.textContent = 'Current resource policy unavailable.';
    }
  }
  async function review(action: 'mode' | 'rollback') {
    if (region.hidden || busy) return;
    busy = true;
    const token = epoch;
    try {
      await port(action);
    } catch {
      if (token === epoch) status.textContent = 'Resource policy review unavailable.';
      return;
    } finally { busy = false; }
    await read();
  }
  refresh.onclick = () => void read();
  change.onclick = () => void review('mode');
  rollback.onclick = () => void review('rollback');
  return {
    element: region,
    setVisible(visible: boolean) {
      if (!visible) { clear(); return; }
      if (region.hidden) { region.hidden = false; void read(); }
    },
  };
}
