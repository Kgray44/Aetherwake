import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Save } from 'lucide-react';
import { proposalChecks } from '../intake.mjs';
import { dependencyGraph } from './task-workspace.mjs';

const takeSnapshot = (task, control, editable = task.state === 'proposed') => ({ task, version: control.version, priority: control.priority, editable });

export function ProposalControls({ task, control, tasks, classes, headers, readFields, refresh, manageable, engineCommand, engineEditable, onHistory }) {
  const reduce = useReducedMotion();
  const [snapshot, setSnapshot] = useState(() => takeSnapshot(task, control, engineEditable));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [history, setHistory] = useState(null);
  const [transition, setTransition] = useState('');
  const [confirm, setConfirm] = useState(false);
  const pending = useRef(false);
  const operation = useRef(null);
  const endpoint = '/api/tasks/' + encodeURIComponent(task.id) + '/control';
  const stored = snapshot.task;
  const changed = control.version > snapshot.version;
  const dependencies = dependencyGraph({
    ...task, prerequisites: { task_ids: draft?.dependencies ?? stored.prerequisites.task_ids },
  }, tasks).upstream;
  const missing = Object.entries(draft ? proposalChecks(draft) : {}).filter(([, valid]) => !valid).map(([name]) => name);
  const selfDependency = dependencies.some(node => node.id === task.id);
  const replacements = tasks.filter(other =>
    other.id !== task.id && manageable(other) && ['proposed', 'blocked'].includes(other.state));

  useEffect(() => {
    if (engineCommand) return;
    const controller = new AbortController();
    fetch(endpoint, { headers, signal: controller.signal }).then(async response => {
      const data = response.ok ? await response.json() : null;
      if (!controller.signal.aborted) setHistory(data?.history ?? false);
    }).catch(() => { if (!controller.signal.aborted) setHistory(false); });
    return () => controller.abort();
  }, [endpoint, headers, control.version, Boolean(engineCommand)]);

  useEffect(() => {
    if (history!==null) onHistory?.({ taskId:task.id, receipts:history||[], unavailable:history===false });
  }, [history,onHistory,task.id]);

  function reset(next) {
    setSnapshot(next);
    setDraft(null);
    setTransition('');
    setConfirm(false);
    setError('');
    setSaved('');
  }

  async function submit(action) {
    if (pending.current || changed) return;
    const payload = JSON.stringify({ ...action, expected_version: snapshot.version });
    if (operation.current?.payload !== payload) operation.current = { payload, id: crypto.randomUUID() };
    pending.current = true;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      if (engineCommand) {
        const next = await engineCommand(action, snapshot.version);
        reset(takeSnapshot(next.task, next, !next.lifecycle.executor && ['proposed', 'blocked'].includes(next.lifecycle.stored_state)));
        setSaved("Task saved.");
        return;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), operation_id: operation.current.id }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error || 'Proposal operation failed');
        if (response.status === 409) await refresh();
        return;
      }
      if (body.task?.id !== task.id || !Number.isSafeInteger(body.version)) {
        throw Error('The operation receipt could not be verified. Refresh and check the Task.');
      }
      reset(takeSnapshot(body.task, body));
      setHistory(body.history ?? []);
      setSaved(action.type === 'edit' ? 'Proposal saved.' : 'Proposal state updated.');
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
    const references = String(data.get('requirements') || '').split('\n').filter(line => line.trim());
    if (references.some(line => line.split('|').length < 2 || line.split('|').length > 3)) {
      setError('Enter a kind and URI for each requirement. A revision is optional.');
      return;
    }
    const requirements = references.map(line => {
      const [kind, uri, revision] = line.split('|').map(part => part.trim());
      return { kind, uri, ...(revision ? { revision } : {}) };
    });
    if (!Object.values(proposalChecks(fields)).every(Boolean) || fields.dependencies.includes(task.id)) {
      setError('Complete admission checks and remove any self-dependency.');
      return;
    }
    submit({ type: 'edit', fields: { ...fields, requirements, priority: data.get('priority') } });
  }

  function changeState(event) {
    event.preventDefault();
    if (draft || !transition) return;
    if (['cancelled', 'superseded'].includes(transition) && !confirm) {
      setConfirm(true);
      return;
    }
    const fields = new FormData(event.currentTarget);
    submit({ type: 'transition', state: transition, reason: fields.get('reason'),
      ...(transition === 'superseded' ? { superseded_by: fields.get('successor') } : {}) });
  }

  return <>
    <p className="low">Version {snapshot.version} · {snapshot.priority} priority</p>
    {changed && <div className="notice" role="status">
      <span>Version {control.version} is available. {draft ? 'Loading it clears your unsaved changes.' : 'Load it to continue.'}</span>
      <button className="quiet-button" type="button" disabled={busy} onClick={() => reset(takeSnapshot(task, control, engineEditable))}>Load latest version</button>
    </div>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {engineCommand && !snapshot.editable && <p>Task fields are read-only in the current execution state.</p>}
    {snapshot.editable && <form key={snapshot.version} aria-label="Edit proposed task" className="form task-editor"
      onSubmit={edit} onChange={event => { setDraft(readFields(event.currentTarget)); setSaved(''); }}>
      <fieldset className="task-editor-fields" disabled={busy}>
        <label>Task title <input name="title" defaultValue={stored.title} required minLength={4} maxLength={160}/></label>
        <label>Objective <textarea name="objective" defaultValue={stored.objective} required minLength={12} maxLength={6000}/></label>
        <div className="form-grid">
          <label>Category <select name="primary" defaultValue={stored.classification.primary}>{classes.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Priority <select name="priority" defaultValue={snapshot.priority}>{['low', 'normal', 'high', 'urgent'].map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <label>Prerequisite Task IDs <input name="dependencies" defaultValue={stored.prerequisites.task_ids.join(', ')}/></label>
        <label>Required capabilities <input name="capabilities" defaultValue={stored.prerequisites.capabilities.join(', ')}/></label>
        <label>Requirements, one kind | URI | optional revision per line
          <textarea name="requirements" defaultValue={(stored.requirements ?? []).map(ref => [ref.kind, ref.uri, ref.revision].filter(Boolean).join(' | ')).join('\n')}/>
        </label>
        <label>Verification profile <input name="profile_id" defaultValue={stored.acceptance.profile_id} required/></label>
        <label>Acceptance criteria, one per line
          <textarea name="criteria" defaultValue={stored.acceptance.criteria.map(criterion => criterion.description).join('\n')} required/>
        </label>
      </fieldset>
      <section className="task-editor-admission" aria-label="Task admission">
        <h3>Task admission</h3>
        {selfDependency && <p role="alert">A Task cannot be its own prerequisite.</p>}
        {missing.length > 0 && <p role="status">Incomplete: {missing.join(', ')}.</p>}
        {!missing.length && !selfDependency && <p>Required proposal fields are complete.</p>}
        {dependencies.length > 0 && <ul>{dependencies.map(node => <li key={node.id}>
          {node.task?.title ?? node.id} · {node.id === task.id ? 'unsatisfied' : node.status}
        </li>)}</ul>}
        {(draft?.capabilities ?? stored.prerequisites.capabilities).length > 0 && <p>Required capabilities are unverified.</p>}
        <p>Execution admission is unverified.</p>
      </section>
      <div className="form-actions">
        <motion.button className="primary-button" type="submit" disabled={busy || !draft || changed || missing.length > 0 || selfDependency}
          whileTap={reduce ? undefined : { scale: .97 }}>
          <Save size={16} aria-hidden="true"/>{busy ? 'Saving…' : 'Save proposal'}
        </motion.button>
        <span role="status">{draft ? 'Unsaved changes' : saved}</span>
      </div>
    </form>}
    {stored.state !== 'proposed' && saved && <p role="status">{saved}</p>}
    {!engineCommand && ['proposed', 'blocked'].includes(stored.state) && <details className="proposal-disclosure" open>
      <summary>Proposal state controls</summary>
      <form className="form" aria-label="Change proposal state" key={snapshot.version} onSubmit={changeState}>
        <label>New state <select value={transition} onChange={event => { setTransition(event.target.value); setConfirm(false); }} required>
          <option value="">Choose state</option>
          <option value={stored.state === 'blocked' ? 'proposed' : 'blocked'}>{stored.state === 'blocked' ? 'Return to proposed' : 'Block'}</option>
          <option value="cancelled">Cancel</option><option value="superseded">Supersede</option>
        </select></label>
        {transition === 'superseded' && <label>Replacement Task <select name="successor" required>
          <option value="">Choose a Task</option>{replacements.map(other => <option key={other.id} value={other.id}>{other.title}</option>)}
        </select></label>}
        <label>Reason <input name="reason" maxLength={500} required onChange={() => setConfirm(false)}/></label>
        <AnimatePresence initial={false}>
          {confirm && <motion.div className="notice" role="status" initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}>
            <span>{transition === 'cancelled' ? 'Cancel this proposal?' : 'Supersede this proposal?'} This state change cannot be undone here.</span>
            <button className="quiet-button" type="button" onClick={() => setConfirm(false)}>Keep proposal</button>
          </motion.div>}
        </AnimatePresence>
        <div><button className="quiet-button" disabled={busy || Boolean(draft) || changed || !transition}>
          {confirm ? 'Confirm state change' : 'Apply state change'}
        </button></div>
      </form>
    </details>}
    {!engineCommand && <details className="proposal-disclosure"><summary>Change history</summary>
      {history === null ? <p>Loading history…</p> : history === false ? <p>History unavailable.</p> : history.length === 0
        ? <p>No changes recorded.</p>
        : <ol>{[...history].reverse().map(receipt => <li key={receipt.operation_id}>
          Version {receipt.version} · {receipt.state ?? receipt.type} · {receipt.actor} · {new Date(receipt.at).toLocaleString()}
          {receipt.reason && <p>{receipt.reason}</p>}
        </li>)}</ol>}
    </details>}
  </>;
}
