import React, { useEffect, useRef, useState } from 'react';
import { createTelemetryClient, readStagedSnapshot, retryTelemetry, stagedFilename } from './telemetry-client.mjs';

async function savedConnection(scope, value) {
  const db = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('observatory-local-telemetry', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('sources');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sources', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('sources');
      const request = value === undefined ? store.get(scope) : value === null ? store.delete(scope) : store.put(value, scope);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? Error('Telemetry connection storage unavailable'));
    });
  } finally { db.close(); }
}

export function useAutomaticTelemetry({ scope, headers, refresh }) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const [connection, setConnection] = useState(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const active = connection?.scope === scope ? connection : null;
  const supported = Boolean(globalThis.showDirectoryPicker);

  useEffect(() => {
    if (!scope || !supported) return;
    let current = true;
    savedConnection(scope).then(async saved => {
      if (!current || !saved) return;
      const granted = await saved.directory.queryPermission({ mode: 'read' }) === 'granted';
      if (!current) return;
      setConnection({ ...saved, scope });
      setRunning(granted);
      setStatus(granted ? 'Checking the selected staging directory.' : 'Restore read access to resume synchronization.');
    }).catch(() => { if (current) setStatus('Saved directory access unavailable. Connect the directory again.'); });
    return () => { current = false; };
  }, [scope, supported]);

  async function choose() {
    setConfiguring(true);
    try {
      const directory = await globalThis.showDirectoryPicker({ mode: 'read', id: 'observatory-task-telemetry' });
      const file = await (await directory.getFileHandle(stagedFilename)).getFile();
      const { taskId } = await readStagedSnapshot(file);
      const saved = { directory, taskId };
      // Persist consent before the first automatic transfer.
      await savedConnection(scope, saved);
      setConnection({ ...saved, scope });
      setStatus('Checking the selected staging directory.');
      setRunning(true);
    } catch (cause) {
      if (cause.name !== 'AbortError') setStatus(cause.message);
    } finally { setConfiguring(false); }
  }

  async function resume() {
    if (!active) return;
    try {
      const permission = await active.directory.requestPermission({ mode: 'read' });
      if (permission !== 'granted') { setStatus('Read access was not granted.'); return; }
      setRunning(true);
      setStatus('Checking the selected staging directory.');
    } catch { setStatus('Directory access unavailable. Connect the directory again.'); }
  }

  async function disconnect() {
    setRunning(false);
    try {
      await savedConnection(scope, null);
      setConnection(null);
      setStatus('Automatic synchronization disconnected.');
    } catch { setStatus('Synchronization paused. Saved connection could not be removed.'); }
  }

  useEffect(() => {
    if (!active || !running) return;
    const controller = new AbortController();
    const { signal } = controller;
    const client = createTelemetryClient({ headers, scope });
    let timer;
    let seenFile;
    let seenReceipt;
    let failures = 0;
    let missing = 0;
    const next = delay => { if (!signal.aborted) timer = setTimeout(check, Math.min(delay, 2147483647)); };
    async function check() {
      try {
        const file = await (await active.directory.getFileHandle(stagedFilename)).getFile();
        if (signal.aborted) return;
        const identity = file.lastModified + ':' + file.size;
        if (identity === seenFile) { next(5000); return; }
        const { taskId, snapshot } = await readStagedSnapshot(file);
        if (taskId !== active.taskId) throw Error('Staging directory now contains a different Task. Reconnect to approve that Task.');
        if (signal.aborted) return;
        const result = await client.synchronize(taskId, snapshot, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
        if (signal.aborted) return;
        seenFile = identity;
        failures = 0;
        missing = 0;
        setStatus('Synchronized ' + taskId + ' at ' + new Date(result.received_at).toLocaleString() + '.');
        // Refresh actual readback records only when this tab committed new data.
        if (result.received_at !== seenReceipt || result.changed) void refreshRef.current();
        seenReceipt = result.received_at;
        next(5000);
      } catch (cause) {
        if (signal.aborted) return;
        if (cause.name === 'NotFoundError' && ++missing <= 3) {
          setStatus('Waiting for the local staging command to write the snapshot.');
          next(5000);
          return;
        }
        const retryAt = retryTelemetry(cause, ++failures);
        if (retryAt !== null) {
          setStatus('Delivery interrupted. Retry ' + failures + ' of 3 is scheduled.');
          next(retryAt - Date.now());
          return;
        }
        setStatus('Synchronization paused. ' + cause.message);
        setRunning(false);
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, running, scope, headers]);

  return { supported, taskId: active?.taskId, status, configuring, choose, resume, disconnect, running: Boolean(active && running) };
}

export function AutomaticTelemetry({ connection }) {
  if (!connection) return null;
  const { supported, taskId, status, configuring, choose, resume, disconnect, running } = connection;
  return <div className="record">
    <h3>Browser recovery delivery</h3>
    <p>Run the AADS staging command on this workstation and connect its private output directory.
      Delivery runs while this signed-in Observatory tab is open. Browser read permission may need renewal after restart.</p>
    {supported && <div className="form-actions">
      {!taskId && <button className="quiet-button" disabled={configuring} onClick={choose}>Connect staging directory</button>}
      {taskId && !running && <button className="quiet-button" onClick={resume}>Resume synchronization</button>}
      {taskId && <button className="quiet-button" onClick={disconnect}>Disconnect directory</button>}
    </div>}
    <p role="status">{supported ? status : 'Automatic directory access requires a browser with the File System Access API. Manual import remains available.'}</p>
  </div>;
}
