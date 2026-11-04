import type { VelaWakeState } from '../../../integrated-backend/src/vela-wake-runtime.mts';
import type { VelaWakePreferences } from '../../../integrated-backend/src/vela-wake-policy.mts';
type Request = { name: 'state' | 'disableWake' | 'masterOff' | 'reconcile'; input: Record<string, never> } |
  { name: 'enable' | 'save'; input: { expectedVersion: number; preferences: VelaWakePreferences } };

export function createVelaWakeView(doc: Document, command: (request: Request) => Promise<unknown>, devices: () => Promise<unknown>) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
  const element = el('section'); element.className = 'vela-wake'; element.setAttribute('aria-label', 'Local wake word');
  const status = el('p', 'Hey Vela is off.'); status.setAttribute('role', 'status');
  const error = el('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  let state: VelaWakeState | null = null, visible = false, disposed = false, busy = false, reading = false, dirty = false, loadedVersion = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const act = (text: string, work: () => Promise<unknown>, safety = false) => {
    const button = el('button', text); button.type = 'button'; button.className = 'vela-core-button';
    button.addEventListener('click', () => { if (!button.disabled) void run(work, safety); }); return button;
  };
  const enable = act('Enable Hey Vela', () => command({ name: 'enable', input: { expectedVersion: state!.settings.version, preferences: preferences() } }));
  const disable = act('Disable wake word', () => command({ name: 'disableWake', input: {} }), true);
  const master = act('Microphone off', () => command({ name: 'masterOff', input: {} }), true);
  const reconcile = act('Check voice closure', () => command({ name: 'reconcile', input: {} }), true);
  const advanced = el('details'), summary = el('summary', 'Wake word settings');
  const field = (label: string, input: HTMLElement) => { const row = el('label'); row.className = 'vela-core-field'; row.append(el('span', label), input); return row; };
  const sensitivity = el('input'); sensitivity.type = 'range'; sensitivity.min = '0'; sensitivity.max = '1'; sensitivity.step = '.05';
  const idle = el('select'); for (const seconds of [15, 20, 30, 60, 120]) { const option = el('option', seconds + ' seconds'); option.value = String(seconds * 1000); idle.append(option); }
  const greeting = el('input'); greeting.type = 'checkbox';
  const microphone = el('select'), defaultMic = el('option', 'Default microphone'); defaultMic.value = ''; microphone.append(defaultMic);
  for (const input of [sensitivity, idle, greeting, microphone]) input.addEventListener('change', () => { dirty = true; });
  const refreshDevices = act('Refresh microphones', async () => {
    const result = await devices(); if (!Array.isArray(result)) throw Error('wake_devices_unavailable');
    const selected = microphone.value; microphone.replaceChildren(defaultMic);
    for (const device of result.filter(item => item?.kind === 'audioinput' && typeof item.id === 'string' && typeof item.label === 'string')) {
      const option = el('option', device.label || 'Microphone'); option.value = device.id; microphone.append(option);
    }
    if ([...microphone.options].some(option => option.value === selected)) microphone.value = selected;
    return null;
  });
  const save = act('Save wake settings', async () => { const value = await command({ name: 'save', input: { expectedVersion: state!.settings.version, preferences: preferences() } }); dirty = false; loadedVersion = -1; return value; });
  const privacy = el('p', '“Hey Vela” (VAY-luh) is detected locally. Armed listening sends no audio to OpenAI. After activation, voice uses your Vela API connection and closes after the selected idle time. Disabling the wake word leaves manual voice available. Microphone off ends both.'); privacy.className = 'vela-core-meta';
  const availability = el('p'); availability.className = 'vela-core-meta';
  advanced.append(summary, field('Sensitivity', sensitivity), field('Close voice after inactivity', idle), field('Greet when no command follows', greeting), field('Microphone', microphone), refreshDevices, save, privacy, availability);
  element.append(status, enable, disable, master, reconcile, error, advanced);
  function preferences(): VelaWakePreferences { return { phraseId: 'hey-vela', sensitivity: Number(sensitivity.value), idleTimeoutMs: Number(idle.value), dynamicGreeting: greeting.checked, ...(microphone.value ? { inputDeviceId: microphone.value } : {}) }; }
  function accept(value: unknown) {
    const next = value as VelaWakeState;
    if (!next || !['OFF', 'ARMED', 'ACTIVATING', 'LISTENING', 'SPEAKING', 'WORKING', 'COOLDOWN', 'ERROR'].includes(next.phase) || !next.settings || !Number.isSafeInteger(next.settings.version) || !next.settings.preferences) throw Error('wake_state_invalid');
    state = next;
    if (!dirty && loadedVersion !== next.settings.version) {
      loadedVersion = next.settings.version; const saved = next.settings.preferences;
      sensitivity.value = String(saved.sensitivity); idle.value = String(saved.idleTimeoutMs); greeting.checked = saved.dynamicGreeting;
      if (saved.inputDeviceId && ![...microphone.options].some(option => option.value === saved.inputDeviceId)) { const option = el('option', 'Saved microphone'); option.value = saved.inputDeviceId; microphone.append(option); }
      microphone.value = saved.inputDeviceId || '';
    }
    status.textContent = next.phase === 'ARMED' ? 'Listening locally for “Hey Vela”.' : next.phase === 'ACTIVATING' ? 'Opening voice…' :
      next.phase === 'COOLDOWN' ? 'Voice ended. Rearming locally…' : next.phase === 'ERROR' ? 'Wake word needs attention. Microphone status: ' + next.microphone + '.' :
      next.microphone === 'live' ? 'Voice connected · microphone on.' : next.microphone === 'muted' ? 'Voice connected · microphone muted.' : 'Hey Vela is off.';
    availability.textContent = next.available ? (next.engineQuality === 'unverified' ? 'Local engine accuracy has not passed acceptance yet.' : '') : 'The local wake engine is not ready on this device.';
    render();
  }
  function render() {
    enable.hidden = !!state?.enabled; enable.disabled = busy || !state?.available || state?.engineQuality === 'unverified';
    disable.hidden = !state?.settings.enabled; disable.disabled = !state;
    master.hidden = state?.microphone === 'off' && state?.voice === 'inactive'; master.disabled = !state;
    reconcile.hidden = state?.phase !== 'ERROR'; save.disabled = busy || !state;
  }
  function schedule() { clearTimeout(timer); if (visible && !disposed) timer = setTimeout(() => void refresh(), 1000); }
  async function refresh() { if (disposed || reading || busy) return; reading = true; try { accept(await command({ name: 'state', input: {} })); } catch { /* A passive read cannot grant microphone access. */ } finally { reading = false; schedule(); } }
  async function run(work: () => Promise<unknown>, safety: boolean) {
    if (disposed || busy && !safety) return; if (!safety) busy = true; error.hidden = true; render();
    try { const result = await work(); if (result) accept(result); }
    catch { error.textContent = 'Couldn’t complete that voice control. Check the microphone status before retrying.'; error.hidden = false; }
    finally { if (!safety) busy = false; render(); schedule(); }
  }
  render();
  return { element, setVisible(value: boolean) { visible = value; if (value) void refresh(); else clearTimeout(timer); }, dispose() { disposed = true; clearTimeout(timer); element.remove(); } };
}
