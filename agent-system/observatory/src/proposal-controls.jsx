import React, { useEffect, useRef, useState } from 'react';
import { proposalChecks } from '../intake.mjs';

export function ProposalControls({ task, control, tasks, classes, headers, readFields, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);
  const [transition, setTransition] = useState('');
  const [checks, setChecks] = useState(null);
  const pending = useRef(false);
  const operation = useRef(null);
  const endpoint = '/api/tasks/' + encodeURIComponent(task.id) + '/control';
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { headers, signal: controller.signal }).then(async response => {
      setHistory(response.ok ? (await response.json()).history : false);
    }).catch(() => { if (!controller.signal.aborted) setHistory(false); });
    return () => controller.abort();
  }, [endpoint, headers]);

  async function submit(action) {
    if (pending.current) return;
    const payload = JSON.stringify({ ...action, expected_version: control.version });
    if (operation.current?.payload !== payload) operation.current = { payload, id: crypto.randomUUID() };
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), operation_id: operation.current.id }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || 'Proposal operation failed');
      await refresh();
    } catch (cause) {
      setError(cause.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function edit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const fields = readFields(form);
    const requirements = String(data.get('requirements') || '').split('\n').filter(line => line.trim()).map(line => {
      const [kind, uri, revision] = line.split('|').map(part => part.trim());
      return { kind, uri, ...(revision ? { revision } : {}) };
    });
    if (!Object.values(proposalChecks(fields)).every(Boolean)) {
      setError('Complete the proposal fields listed below.');
      return;
    }
    submit({ type: 'edit', fields: { ...fields, requirements, priority: data.get('priority') } });
  }

  const unresolved = (task.prerequisites?.task_ids ?? []).filter(id => tasks.find(other => other.id === id)?.state !== 'accepted');
  const replacements = tasks.filter(other => other.id !== task.id && ['proposed', 'blocked'].includes(other.state));
  const missing = Object.entries(checks ?? {}).filter(([, valid]) => !valid).map(([name]) => name);
  return <>
    <p>Version {control.version} · {control.priority} priority</p>
    <p>{unresolved.length ? 'Unresolved task prerequisites: ' + unresolved.join(', ') : 'All declared task prerequisites are accepted.'}
      {' '}{task.prerequisites?.capabilities?.length ? 'Capability availability needs review.' : 'No capabilities declared.'}</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {task.state === 'proposed' && <details>
      <summary>Edit proposed task</summary>
      <form className="form" onSubmit={edit} onChange={event => setChecks(proposalChecks(readFields(event.currentTarget)))}>
        <label>Task title <input name="title" defaultValue={task.title} required minLength={4} maxLength={160}/></label>
        <label>Objective <textarea name="objective" defaultValue={task.objective} required minLength={12} maxLength={6000}/></label>
        <div className="form-grid">
          <label>Category <select name="primary" defaultValue={task.classification.primary}>{classes.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Priority <select name="priority" defaultValue={control.priority}>{['low', 'normal', 'high', 'urgent'].map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <label>Prerequisite task IDs <input name="dependencies" defaultValue={task.prerequisites.task_ids.join(', ')}/></label>
        <label>Required capabilities <input name="capabilities" defaultValue={task.prerequisites.capabilities.join(', ')}/></label>
        <label>Requirements, one kind | URI | optional revision per line
          <textarea name="requirements" defaultValue={(task.requirements ?? []).map(ref => [ref.kind, ref.uri, ref.revision].filter(Boolean).join(' | ')).join('\n')}/>
        </label>
        <label>Verification profile <input name="profile_id" defaultValue={task.acceptance.profile_id} required/></label>
        <label>Acceptance criteria, one per line
          <textarea name="criteria" defaultValue={task.acceptance.criteria.map(criterion => criterion.description).join('\n')} required/>
        </label>
        {missing.length > 0 && <p role="status">Check {missing.join(', ')}.</p>}
        <div><button className="primary-button" disabled={busy || missing.length > 0}>Save proposal</button></div>
      </form>
    </details>}
    {['proposed', 'blocked'].includes(task.state) && <details>
      <summary>Change proposal state</summary>
      <form className="form" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        submit({ type: 'transition', state: transition, reason: fields.get('reason'),
          ...(transition === 'superseded' ? { superseded_by: fields.get('successor') } : {}) });
      }}>
        <label>New state <select value={transition} onChange={event => setTransition(event.target.value)} required>
          <option value="">Choose state</option>
          <option value={task.state === 'blocked' ? 'proposed' : 'blocked'}>{task.state === 'blocked' ? 'Return to proposed' : 'Block'}</option>
          <option value="cancelled">Cancel</option><option value="superseded">Supersede</option>
        </select></label>
        {transition === 'superseded' && <label>Replacement task <select name="successor" required>
          <option value="">Choose a task</option>{replacements.map(other => <option key={other.id} value={other.id}>{other.title}</option>)}
        </select></label>}
        <label>Reason <input name="reason" maxLength={500} required/></label>
        <div><button className="quiet-button" disabled={busy || !transition}>Apply state change</button></div>
      </form>
    </details>}
    <details><summary>Change history</summary>
      {history === null ? <p>Loading history…</p> : history === false ? <p>History unavailable.</p> : history.length === 0
        ? <p>No changes recorded.</p>
        : <ol>{[...history].reverse().map(receipt => <li key={receipt.operation_id}>
          Version {receipt.version} · {receipt.state ?? receipt.type} · {receipt.actor} · {new Date(receipt.at).toLocaleString()}
          {receipt.reason && <p>{receipt.reason}</p>}
        </li>)}</ol>}
    </details>
  </>;
}
