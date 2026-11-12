# FI-0 evaluation reference binding

This additive contract completes the current native task-evaluation reference boundary. It does not implement FI-5 controlled experiments, an experiment database, independent semantic/artistic grading, or policy promotion. AEP keeps reference records; MissionService remains the canonical task, evidence and verification owner.

## Callable boundary

The existing Core `missions` command accepts `name: 'evaluation-reference'` with a closed input:

```typescript
{
  contract: 'aerynth.experience.evaluation-reference@1',
  namespace: 'mission-verification',
  missionId: string,
  missionRevision: number,
  planRevision: number,
  taskId: string,
  attemptId: string,
  evidenceId: string
}
```

IDs use the existing bounded reference alphabet and revisions are positive safe integers. Unknown versions/namespaces, extra fields (including claimed evaluator authority), malformed identities and absent fields fail. The caller's current scope comes from Core, not the reference. There is no renderer grant, arbitrary source namespace, evaluator callback or external lookup.

`resolveAepEvaluationReference` in `prototypes/integrated-backend/src/aep-evaluation-reference.mts` calls `MissionService.read` on every resolution. It requires exact current mission and plan revisions, the current task's latest attempt, a verified outcome, matching evidence ID/attempt/source and the canonical passed verification's exact criterion/evidence binding. Canonical projection rechecks source context and hides invalidated evidence; scope denial, correction or revocation therefore cannot be bypassed by reusing an old reference.

The only supported authorities are existing native `sample.cpu` / `node:os.cpus` and `sample.ram` / `node:os.totalmem+freemem` task verifiers. Specialist/provider reports, joins, arbitrary artifacts and imported evaluator assertions are unsupported. This deliberately covers the current host-oracle domain rather than inventing reviewer records. The host verifier is separate from a model's proposed strategy; its result establishes native evidence validity only. It does not independently grade the experiment or prove a performance improvement.

## Returned evidence and limitations

The bodyless response is `aerynth.experience.evaluation@1`, kind `evaluation-reference`, with:

- Stable ID `mission-verification:<sha256>` over canonical locator fields. It fits the experiment decoder's existing bounded reference strings; property ordering does not change identity.
- The exact reference and canonical source scope.
- Fixed authority `canonical-task-verifier`, owner `MissionService`, supported executor.
- Assessed evidence ID, SHA-256 digest of the canonical evidence and criterion. No sample body, prompt, file content or private native path is returned.
- `result: 'passed'`, `coverage: 'native-task-evidence-only'`, `independentExperimentQuality: 'not-evaluated'`, and `policyPromotion: 'not-authorized'`.

The result is a current authorized projection, not a durable grant or cached verification permission. Re-resolve before subsequent use. A stable ID/digest does not permit disclosure to another scope or provider. Historical CPU/RAM evidence is not a current resource sample or a live lease.

The original `readAepExperiment` / `readAepFinding` functions remain syntax/binding decoders. A decoded `qualityGate: 'pass'` is not converted into experiment-wide independent quality by this endpoint. A caller must not use a task-only result to certify whole-answer quality, causal speedup or policy activation. The existing native comparison continues to expose `independentEvaluation: null`.

## Ownership, compatibility and retention

No new table, stored evaluator, event journal or policy owner is introduced. Reads use existing source-owner authorization; no permission is persisted. Existing mission records and proposal formats remain unchanged, so no migration is needed. Older builds simply do not expose this additive command. Returned references can become stale after a legitimate mission revision; the reader fails rather than guessing a replacement.

No collection default, retained-measurement lifetime, backup behavior, export destination or audit exemption changes. Live telemetry remains governed by its existing freshness/collection settings, durable evidence by its original owners. The absence of a new store does not erase existing retention obligations.

## Verification and remaining phase boundary

Focused tests use real MissionService/SQLite and Core routing with labeled synthetic native samples and actual native verifier functions. They cover closed schemas, canonical property order, CPU/RAM authority, wrong mission/plan/task/attempt/evidence identity, unsupported provider authority/source, source-version change, access revocation, body omission and exact readback after reopening. No provider call or resource stress is needed.

Run:

```sh
node --test prototypes/integrated-backend/tests/aep-experience-contract.test.mts prototypes/integrated-backend/tests/aep-evaluation-reference.test.mts prototypes/integrated-backend/tests/aep-evaluation-core.test.mts
npm --prefix prototypes/integrated-backend run typecheck
```

Independent experiment-wide evaluation requires actual assessment records, cohort/holdout design and output-quality evidence. Those are later experimental-learning work, not fields to fabricate from native task receipts. This contract defines and implements the supported FI-0 reference domain now and fails closed for unsupported domains; it does not declare the broader FI acceptance program complete.
