import type { VelaVoiceRequest, VelaVoiceState } from '../../../integrated-backend/src/vela-voice-runtime.mts';
import type { GptLiveAudioDevice } from './gpt-live-media.ts';
import { estimateLiveUsage } from '../../../openai-provider/live-usage.mts';
export interface VelaVoicePresence { active: boolean; microphoneOn: boolean; speaking: boolean }

/** A view of the native voice session. It owns neither media nor conversation history. */
export function createVelaVoiceView(doc: Document, command: (request: VelaVoiceRequest) => Promise<unknown>) {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node;
  };
  const element = make('section'); element.className = 'vela-voice'; element.setAttribute('aria-label', 'Voice conversation');
  const status = make('p', 'Voice is off.'), caption = make('p'), error = make('p');
  status.setAttribute('role', 'status'); caption.className = 'vela-voice-caption'; caption.setAttribute('aria-live', 'off');
  error.setAttribute('role', 'alert'); error.hidden = true;
  const controls = make('div'); controls.className = 'vela-voice-actions';
  let state: VelaVoiceState | null = null, visible = false, disposed = false, pending = false, reading = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined, settingsVersion = -1;
  const listeners = new Set<(presence: VelaVoicePresence) => void>();
  const active = () => !!state && ['starting', 'awaiting-start', 'running', 'closing'].includes(state.session.state);
  function presence(): VelaVoicePresence { return { active: active(), microphoneOn: state?.media?.microphoneAccess === 'active' && state.media.localTrackEnabled,
    speaking: state?.media?.playback === 'playing' && state.media.playbackObserved }; }
  const act = (text: string, work: () => Promise<unknown>) => {
    const button = make('button', text); button.type = 'button'; button.className = 'vela-core-button';
    button.addEventListener('click', () => { void run(work).catch(() => {}); }); return button;
  };
  function failure(value: unknown) {
    const code = value instanceof Error ? value.message : '';
    error.textContent = /settings_changed/.test(code) ? 'Voice settings changed. Reopen voice settings before saving.' :
      /usage|configuration|credential/.test(code) ? 'Check Vela API usage in Connections.' :
      /permission|capture/.test(code) ? 'Microphone access is unavailable. Check your device permissions.' :
      /busy/.test(code) ? 'A voice operation is already running.' : 'Voice could not complete that action. Your conversation is saved.';
    error.hidden = false;
  }
  async function run(work: () => Promise<unknown>) {
    if (pending || disposed) throw new Error('live_session_busy');
    pending = true; error.hidden = true; render();
    try { const value = await work(); if (isState(value)) accept(value); else await refresh(); }
    catch (cause) { failure(cause); throw cause; }
    finally { pending = false; render(); schedule(); }
  }
  const startButton = act('Start voice', () => command({ name: state?.session.state === 'unknown' ? 'reconnect' : 'start', input: {} }));
  const stopButton = act('End', () => command({ name: 'stop', input: {} }));
  const muteButton = act('Mute', () => command({ name: 'mute', input: { muted: state?.media?.localTrackEnabled !== false } }));
  const resumeButton = act('Play audio', () => command({ name: 'resumePlayback', input: {} }));
  const interruptButton = act('Interrupt', () => command({ name: 'interruptPlayback', input: {} }));
  controls.append(startButton, stopButton, muteButton, resumeButton, interruptButton);
  const advanced = make('details'), summary = make('summary', 'Voice settings'), settings = make('div'); settings.className = 'vela-voice-settings';
  const field = (text: string, input: HTMLElement) => { const label = make('label'), name = make('span', text); label.className = 'vela-core-field'; label.append(name, input); return label; };
  const personality = make('textarea'); personality.maxLength = 1500; personality.rows = 3;
  personality.className = 'vela-core-input'; personality.addEventListener('input', () => { dirty = true; });
  const voice = make('select'); voice.className = 'vela-core-input'; voice.addEventListener('change', () => { dirty = true; });
  const save = act('Save voice', async () => {
    const result = await command({ name: 'saveVoice', input: { voiceId: voice.value || null, expectedSettingsVersion: settingsVersion, speechPersonality: personality.value } });
    dirty = false; if (isState(result)) { settingsVersion = -1; accept(result); } return result;
  });
  const reload = act('Reload saved settings', async () => { dirty = false; settingsVersion = -1; await refresh(); });
  const catalogStatus=make('p','Vela 3 is the default. Voice changes apply to the next session.');catalogStatus.className='vela-core-meta';
  const refreshVoices=act('Refresh saved voices',()=>command({name:'refreshVoices',input:{}}));
  advanced.addEventListener('toggle',()=>{if(advanced.open&&visible&&!pending)void run(()=>command({name:'refreshVoices',input:{}})).catch(()=>{});});
  const audition = act('Preview voice', () => command({ name: 'audition', input: { ...(voice.value ? { voiceId: voice.value } : {}), sample: 'Hello. I’m Vela. What shall we work on together?' } }));
  const name = make('input'); name.maxLength = 80; name.className = 'vela-core-input';
  const prompt = make('textarea'); prompt.maxLength = 1200; prompt.rows = 3; prompt.className = 'vela-core-input';
  const create = act('Create voice', async () => {
    if (!name.value.trim() || !prompt.value.trim()) throw new Error('voice_prompt_required');
    const result = await command({ name: 'createVoice', input: { name: name.value.trim(), prompt: prompt.value.trim() } });
    if ((result as { state?: string })?.state !== 'created') throw new Error('voice_creation_failed');
    name.value = ''; prompt.value = ''; await refresh(); return result;
  });
  const input = make('select'), output = make('select'); input.className = output.className = 'vela-core-input';
  input.addEventListener('change', () => { void run(() => command({ name: 'setInputDevice', input: { deviceId: input.value } })).catch(() => {}); });
  output.addEventListener('change', () => { void run(() => command({ name: 'setOutputDevice', input: { deviceId: output.value } })).catch(() => {}); });
  const deviceButton = act('Refresh devices', async () => {
    const devices = await command({ name: 'devices', input: {} }) as GptLiveAudioDevice[];
    for (const [select, kind] of [[input, 'audioinput'], [output, 'audiooutput']] as const) {
      const selected = select.value; select.replaceChildren();
      for (const device of devices.filter(item => item.kind === kind)) { const option = make('option', device.label || (kind === 'audioinput' ? 'Microphone' : 'Speaker')); option.value = device.id; select.append(option); }
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }
  });
  const billing = make('p', 'Starting or previewing voice uses the Vela API: up to 5 minutes per session, including 15 seconds of initial exposure. Creating a prompt voice is free.'); billing.className = 'vela-core-meta';
  const usage = make('p'); usage.className = 'vela-core-meta';
  settings.append(field('Voice', voice),catalogStatus,refreshVoices, field('Speaking style', personality), save, reload, audition,
    field('New voice name', name), field('Describe the voice', prompt), create,
    field('Microphone', input), field('Speaker', output), deviceButton, billing, usage);
  advanced.append(summary, settings); element.append(status, caption, error, controls, advanced);
  function isState(value: unknown): value is VelaVoiceState { return !!value && typeof value === 'object' && 'session' in value && 'settings' in value && 'media' in value; }
  function accept(value: VelaVoiceState) { if (!disposed) { state = value; render(); } }
  function render() {
    const session = state?.session, active = !!session && ['starting', 'awaiting-start', 'running', 'closing'].includes(session.state);
    status.textContent = !state ? 'Voice is off.' : !state.available ? state.reason || 'Voice is unavailable.' :
      session?.state === 'running' ? state.media?.localTrackEnabled === false ? 'Microphone muted.' : state.media?.microphoneAccess === 'active' ? 'Voice is on.' : 'Voice is connected.' :
      session?.state === 'starting' || session?.state === 'awaiting-start' ? 'Connecting…' : session?.state === 'unknown' ? 'Connection interrupted. Reconnect to continue.' : session?.state === 'failed' ? 'Voice could not connect.' : 'Voice is off.';
    element.dataset.state = session?.state || 'idle';
    if (session?.usage) {
      const estimate = estimateLiveUsage(session);
      usage.textContent = estimate.reportedSeconds !== null
        ? `${estimate.reportedSeconds} seconds reported${estimate.reportedFinal ? ' (final)' : ''}. Voice estimate: $${estimate.estimatedUSD!.toFixed(4)}; backend usage is separate.`
        : estimate.initializationExposureSeconds ? 'Voice duration is unconfirmed. Initial exposure may apply; billed usage is not known.' : 'No paid voice session started.';
    } else usage.textContent = '';
    for (const listener of listeners) try { listener(presence()); } catch { /* Observers cannot grant or block voice actions. */ }
    const last = state?.captions.filter(item => item.role === 'assistant').at(-1); caption.textContent = last?.content || ''; caption.hidden = !last;
    startButton.hidden = active; startButton.disabled = pending || !state?.available; startButton.textContent = session?.state === 'unknown' ? 'Reconnect' : 'Start voice';
    stopButton.hidden = !active && session?.state !== 'unknown'; stopButton.disabled = pending;
    muteButton.hidden = !active; muteButton.disabled = pending || session?.state !== 'running'; muteButton.textContent = state?.media?.localTrackEnabled === false ? 'Unmute' : 'Mute';
    muteButton.setAttribute('aria-pressed', String(state?.media?.localTrackEnabled === false));
    resumeButton.hidden = state?.media?.playback !== 'blocked'; resumeButton.disabled = pending;
    interruptButton.hidden = !active; interruptButton.disabled = pending || session?.state !== 'running';
    for (const button of [reload, audition, create, deviceButton]) button.disabled = pending || !state?.available || active;
    save.disabled=pending||!state?.available||!voice.value||[...voice.options].find(option=>option.value===voice.value)?.disabled===true;
    refreshVoices.disabled=pending||!state?.usage.enabled;voice.disabled=pending;personality.disabled=pending||active;
    input.disabled = output.disabled = pending;
    if (state && !dirty && settingsVersion !== state.settings.version) {
      settingsVersion = state.settings.version; personality.value = state.settings.speechPersonality;
      voice.replaceChildren();
      for(const name of ['Vela 3','Vela 2']){const candidate=state.settings.candidates.find(candidate=>candidate.name===name),selected=state.settings.selectedVoice?.name===name?state.settings.selectedVoice:null,option=make('option',candidate?name:name+' — unavailable');option.value=candidate?.id??selected?.id??'';option.disabled=!candidate;voice.append(option);}
      voice.value = state.settings.selectedVoice?.id || '';
    } else if (state) {
      for(const name of ['Vela 3','Vela 2']){const candidate=state.settings.candidates.find(candidate=>candidate.name===name),option=[...voice.options].find(option=>option.textContent?.startsWith(name));if(option){option.value=candidate?.id??(state.settings.selectedVoice?.name===name?state.settings.selectedVoice.id:'');option.disabled=!candidate;option.textContent=candidate?name:name+' — unavailable';}}
    }
    if(state){const catalog=state.settings.catalog;catalogStatus.textContent=catalog?.state==='unavailable'?'Saved voices could not be checked. Refresh them or check the Vela API connection.':catalog?.state==='unresolved'?'Vela 3 is the default. Load the saved voices or start voice to check access.':!state.settings.selectedVoice&&!state.settings.candidates.some(voice=>voice.name==='Vela 3')?'Vela 3 is unavailable. Choose Vela 2 or check the Vela API connection.':active?'Saved voice changes apply to your next session.':'Vela 3 is the default. Voice changes apply to the next session.';save.disabled=pending||!state.available||!voice.value||[...voice.options].find(option=>option.value===voice.value)?.disabled===true;}
  }
  async function refresh() {
    if (reading || disposed) return; reading = true;
    try { const value = await command({ name: 'state', input: {} }); if (isState(value)) accept(value); }
    catch (cause) { if (visible) failure(cause); }
    finally { reading = false; schedule(); }
  }
  function schedule() {
    clearTimeout(timer); if ((visible || active()) && !disposed && !doc.hidden) timer = setTimeout(() => { void refresh(); }, visible ? 900 : 3000);
  }
  const visibility = () => { if (doc.hidden) clearTimeout(timer); else if (visible || active()) void refresh(); };
  doc.addEventListener('visibilitychange', visibility);
  render();
  return {
    element,
    setVisible(value: boolean) { visible = value; if (value) void refresh(); else schedule(); },
    observe() { if ((visible || active()) && !reading) schedule(); },
    subscribe(listener: (value: VelaVoicePresence) => void) { listeners.add(listener); listener(presence()); return () => { listeners.delete(listener); }; },
    async start(intent?: string) { await run(async () => { const value = await command({ name: 'start', input: { ...(intent ? { intent } : {}) } });
      if (!isState(value) || !['starting', 'awaiting-start', 'running'].includes(value.session.state)) throw new Error('live_start_unconfirmed'); return value; }); },
    dispose() { disposed = true; clearTimeout(timer); listeners.clear(); doc.removeEventListener('visibilitychange', visibility); element.remove(); },
  };
}
