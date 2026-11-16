/** Staged enforcement is configured by maintainers, never by a submitted bundle. */
export function evidencePolicy(paths, {stage='tasks', hasBundle=false, declared=false}={}) {
  if (!['submitted','tasks','all-applicable'].includes(stage)) throw Error('Unknown evidence rollout stage');
  if (!Array.isArray(paths)||paths.some(p=>typeof p!=='string')) throw Error('Expected actual changed paths');
  const submission=paths.some(p=>p.startsWith('.agent-evidence/'));
  const task=declared||paths.some(p=>p.startsWith('agent-system/tasks/'));
  const applicable=paths.some(p=>/^(agent-system\/|scripts\/agent\/|prototypes\/|src\/|desktop\/|governance\/|docs\/engineering\/|tests\/agent\/|\.agents\/|AGENTS\.md$|\.github\/workflows\/)/.test(p));
  const required=hasBundle||submission||(stage!=='submitted'&&task)||(stage==='all-applicable'&&applicable);
  return {stage,required,status:required?'evidence-required':'not-verified',reason:hasBundle||submission?'submission':task?'declared-task':applicable?'unmigrated-scope':'unrelated'};
}
