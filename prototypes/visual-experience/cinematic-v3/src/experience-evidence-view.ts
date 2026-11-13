import type { AepRollbackReview, createAepNativeHost } from '../../../integrated-backend/src/aep-native-host.mts';
import type { MissionScope } from '../../../integrated-backend/src/mission-contracts.mts';

type Owner = ReturnType<typeof createAepNativeHost>;
type Summary = ReturnType<Owner['list']>['experiments'][number];
type Evidence = ReturnType<Owner['evidence']>;
type Finding = NonNullable<ReturnType<Owner['finding']>>;
export type ExperienceZone = 'learning' | 'experiment' | 'timeline';
export type ExperienceRead = (name: 'experience-list' | 'experience-evidence' | 'experience-finding', input: Record<string, string>) => Promise<unknown>;
export type ExperiencePolicyRollback = (review: AepRollbackReview) => Promise<'restored' | 'cancelled'>;
export type ExperienceEvidencePort = { scope: MissionScope; read: ExperienceRead; rollback?: ExperiencePolicyRollback };

const scopeMatches = (source: MissionScope | undefined, expected: MissionScope) =>
  source?.workspaceId === expected.workspaceId && source?.projectId === expected.projectId;
const label = (value: string) => value.replaceAll('-', ' ');
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const candidateLabel = (candidate: Summary['candidate']) => candidate === 'parallel' ? 'Parallel native probes' : 'Omit backend probe';

export function mountExperienceEvidence(doc: Document, scope: MissionScope, read: ExperienceRead, rollback?: ExperiencePolicyRollback) {
  const element = doc.createElement('section'), status = doc.createElement('p'), picker = doc.createElement('select');
  const content = doc.createElement('div'), actions = doc.createElement('div'), refreshButton = doc.createElement('button');
  const actionStatus = doc.createElement('p');
  element.className = 'aw-experience-evidence';
  picker.setAttribute('aria-label', 'Experiment record');
  refreshButton.type = 'button';
  refreshButton.textContent = 'Refresh evidence';
  status.setAttribute('role', 'status');
  actionStatus.setAttribute('role', 'status');
  actions.append(picker, refreshButton);
  element.append(status, actions, actionStatus, content);
  element.hidden = true;
  let zone: ExperienceZone | undefined, selected = '', epoch = 0;
  let reviewing = false;
  let summaries = new Map<string, Summary>();
  function fields(rows: readonly (readonly [string, string | number | null | undefined])[], target: HTMLElement = content) {
    const values = doc.createElement('dl');
    for (const [name, value] of rows) {
      const term = doc.createElement('dt'), detail = doc.createElement('dd');
      term.textContent = name;
      detail.textContent = String(value ?? 'Unavailable');
      values.append(term, detail);
    }
    target.append(values);
  }
  function experiment(evidence: Evidence) {
    const { record } = evidence, { result, experiment } = record;
    fields([['Experiment', experiment.id], ['Revision', experiment.revision], ['Hypothesis', record.hypothesis],
      ['Method', experiment.methodology], ['Baseline policy', experiment.baselinePolicyRef],
      ['Candidate policy', experiment.candidatePolicyRef], ['Cohort', experiment.cohortRef],
      ['Holdout', experiment.holdoutRef], ['Lifecycle', label(record.state)]]);
    if (result) {
      fields([['Decision', result.decision], ['Endpoint', label(result.endpoint)],
        ['Required benefit', number.format(result.minimumEffectMs) + ' ms'],
        ['Baseline quality', result.baselinePassed ? 'Passed' : 'Failed'],
        ['Candidate quality', result.candidatePassed ? 'Passed' : 'Failed'],
        ['Controlled admission', result.controlled ? 'Confirmed' : 'Unconfirmed']]);
      for (const [name, stats] of [['Development', result.development], ['Holdout', result.holdout]] as const) {
        fields([[name + ' measured pairs', stats.measured + ' / ' + stats.enrolled],
          [name + ' median benefit', stats.median === null ? null : number.format(stats.median) + ' ms'],
          [name + ' interval', stats.interval ? number.format(stats.interval.lower) + ' to ' +
            number.format(stats.interval.upper) + ' ms · ' + number.format(stats.interval.coverage * 100) + '% nominal' : null]]);
      }
      fields([['Evaluation limits', result.limits.join(' · ')]]);
    }
    if (!evidence.trials.length) return;
    const disclosure = doc.createElement('details'), summary = doc.createElement('summary');
    summary.textContent = 'Trial evidence (' + evidence.trials.length + ')';
    disclosure.append(summary);
    for (const { trial, assessment } of evidence.trials) {
      const failed = Object.entries(assessment.gates).filter(([, passed]) => !passed).map(([gate]) => gate);
      fields([[label(trial.partition) + ' · pair ' + (trial.pair + 1) + ' · ' + trial.arm, trial.missionId],
        ['Mission revision', trial.revision], ['Quality gates', failed.length ? failed.join(', ') : 'Passed'],
        ['Verified evidence', assessment.proofs.map(proof => proof.evidenceId).join(', ') || 'Unavailable']], disclosure);
    }
    content.append(disclosure);
  }
  function history({ record }: Evidence) {
    const list = doc.createElement('ol');
    for (const event of record.history) {
      const item = doc.createElement('li');
      item.textContent = label(event.state) + ' · ' + event.at + ' · experiment revision ' + event.revision;
      list.append(item);
    }
    content.append(list);
    for (const receipt of record.policyReceipts) {
      fields([['Recorded policy action', label(receipt.state)], ['Policy version ' + receipt.policy.version, receipt.policy.experimentId ?? 'Baseline'],
        ['Governor configuration version', receipt.policy.governorVersion],
        ['Monitored mission', receipt.monitorMissionId]]);
    }
  }
  async function load(selectedSummary: Summary) {
    const token = ++epoch, region = zone, id = selectedSummary.id;
    content.replaceChildren();
    status.textContent = 'Revalidating source evidence…';
    try {
      const value = await read(region === 'learning' ? 'experience-finding' : 'experience-evidence',
        region === 'learning' ? { id, cohort: selectedSummary.cohort } : { id });
      if (token !== epoch) return;
      if (region === 'learning') {
        const finding = value as Finding | null;
        if (!finding) { status.textContent = 'No applicable finding for this experiment and current environment.'; return; }
        if (finding.contract !== 'aerynth.experience.finding@1' || finding.experimentId !== id ||
          finding.experimentRevision !== selectedSummary.revision || finding.cohort !== selectedSummary.cohort ||
          !scopeMatches(finding.scope, scope) || finding.policy && (!scopeMatches(finding.policy.scope, scope) || finding.policy.experimentId !== id))
          throw Error('finding_identity_mismatch');
        status.textContent = 'Revalidated advisory finding';
        fields([['Finding', finding.id], ['Experiment revision', finding.experimentRevision],
          ['Recorded decision', finding.result.decision], ['Lifecycle', label(finding.lifecycle)],
          ['Disposition', label(finding.disposition)], ['Applicability', label(finding.applicability)],
          ['Effective policy', finding.policy ? 'Version ' + finding.policy.version : 'None'],
          ['Effective until', finding.policy?.expiresAtMs ? new Date(finding.policy.expiresAtMs).toISOString() : null]]);
        if (finding.policy && rollback) {
          const button = doc.createElement('button');
          const review = { ...scope, experimentId: id, policyVersion: finding.policy.version };
          button.type = 'button';
          button.textContent = 'Review baseline restoration';
          button.onclick = async () => {
            if (reviewing || token !== epoch) return;
            reviewing = button.disabled = true;
            try {
              if (await rollback(review) === 'restored' && token === epoch) {
                actionStatus.textContent = 'Baseline execution policy restored. The rollback is recorded in the Adaptation Timeline.';
                void refresh();
              }
            } catch {
              if (token === epoch) {
                actionStatus.textContent = 'Restoration could not be confirmed. Check the latest policy and history before trying again.';
                void refresh();
              }
            } finally {
              reviewing = button.disabled = false;
            }
          };
          content.append(button);
        }
      } else {
        const evidence = value as Evidence | null, record = evidence?.record;
        if (evidence?.kind !== 'aep-experiment-evidence' || record?.contract !== 'aerynth.aep.native-experiment@1' ||
          record.experiment.id !== id || record.experiment.revision !== selectedSummary.revision ||
          record.experiment.cohortRef !== selectedSummary.cohort || !scopeMatches(record.experiment.scope, scope))
          throw Error('experiment_identity_mismatch');
        status.textContent = region === 'timeline' ? 'Recorded experiment and policy history' : 'Revalidated experiment evidence';
        if (region === 'timeline') history(evidence);
        else experiment(evidence);
      }
    } catch {
      if (token !== epoch) return;
      content.replaceChildren();
      status.textContent = 'Evidence unavailable. Refresh to check current access and revision.';
    }
  }
  async function refresh() {
    if (!zone) return;
    const token = ++epoch;
    picker.disabled = true;
    picker.replaceChildren();
    content.replaceChildren();
    summaries.clear();
    status.textContent = 'Reading scoped experiments…';
    try {
      const list = await read('experience-list', {}) as ReturnType<Owner['list']> | null;
      if (token !== epoch) return;
      if (list?.kind !== 'aep-experiment-list' || !Array.isArray(list.experiments)) throw Error('experiment_list_unavailable');
      summaries = new Map(list.experiments.map(row => [row.id, row]));
      for (const row of summaries.values()) {
        const option = doc.createElement('option');
        option.value = row.id;
        option.textContent = candidateLabel(row.candidate) + ' · ' + label(row.state) + ' · ' + row.id;
        picker.append(option);
      }
      const next = summaries.get(selected) ?? summaries.values().next().value;
      if (!next) { status.textContent = 'No experiment records in this workspace.'; return; }
      selected = picker.value = next.id;
      picker.disabled = false;
      await load(next);
    } catch {
      if (token === epoch) status.textContent = 'Experiment records unavailable.';
    }
  }
  picker.onchange = () => {
    actionStatus.textContent = '';
    selected = picker.value;
    const summary = summaries.get(selected);
    if (summary) void load(summary);
  };
  refreshButton.onclick = () => void refresh();
  return {
    element,
    show(next?: ExperienceZone) {
      if (zone === next) return;
      actionStatus.textContent = '';
      zone = next;
      element.hidden = !zone;
      if (zone) void refresh();
      else { epoch++; picker.replaceChildren(); content.replaceChildren(); summaries.clear(); status.textContent = ''; }
    },
    refresh,
    clear() {
      epoch++;
      zone = undefined;
      selected = '';
      summaries.clear();
      picker.replaceChildren();
      content.replaceChildren();
      status.textContent = '';
      actionStatus.textContent = '';
      element.hidden = true;
    },
  };
}
