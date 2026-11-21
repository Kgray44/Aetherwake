import {useEffect, useRef, useState} from 'react';
import {commandForTask, taskEngineRequest} from './task-engine-client.mjs';

export function useTaskEngineDetail({ summary, dependencyRevision, workerDispatch, headers, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const pending = useRef(null);
  const id = summary?.task.id;
  const activeTask = useRef(id);
  activeTask.current = id;
  const readRevision = summary?.version;
  const blockers = JSON.stringify(summary?.lifecycle.blockers ?? []);
  const dispatchRevision = JSON.stringify(workerDispatch ?? null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    taskEngineRequest({ op: 'get', task_id: id }, headers, { signal: controller.signal }).then(next => {
      if (!controller.signal.aborted) {
        setDetail(previous => previous?.task.id === id && previous.version > next.version ? previous : next);
        setError('');
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [id, readRevision, summary?.lifecycle.state, blockers, dependencyRevision, dispatchRevision, headers]);
  const current = detail?.task.id === id ? detail : null;
  async function command(action, attemptVersion = current?.version) {
    if (!current) throw Error('Task details are unavailable.');
    const signature = JSON.stringify([id, action.type === 'addendum' ? null : attemptVersion, action]);
    if (pending.current?.signature !== signature) {
      pending.current = { signature, request: commandForTask({ ...current, version: attemptVersion }, action, crypto.randomUUID()) };
    }
    const operation = pending.current;
    try {
      const next = await taskEngineRequest(operation.request, headers);
      if (next.task?.id !== id || !Number.isSafeInteger(next.version)) throw Error('The operation receipt could not be verified.');
      if (pending.current === operation) pending.current = null;
      if (activeTask.current === id) setDetail(previous => previous?.version > next.version ? previous : next);
      void onRefresh();
      return next;
    } catch (cause) {
      if (cause.status === 409) {
        if (pending.current === operation) pending.current = null;
        void onRefresh();
      }
      throw cause;
    }
  }
  return { detail: current, error, command };
}
