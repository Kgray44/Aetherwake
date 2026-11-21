import { TASK_REQUEST_MAX_BYTES } from '../intake.mjs';
import { readBounded } from './github.mjs';

const repository = 'Kgray44/Aetherwake';
const branch = 'observatory-proposed-tasks';
const directory = 'Proposed%20Tasks';

export async function publishProposal(db, fetcher, token, owner, taskId, validate) {
  const row = await db.prepare(
    "SELECT record, github_state FROM proposals WHERE owner_id = ? AND namespace = 'live' AND task_id = ?",
  ).bind(owner, taskId).first();
  if (!row?.github_state) return null;
  const url = `https://github.com/${repository}/blob/${branch}/${directory}/${taskId}.json`;
  if (row.github_state === 'published') return { state: 'published', url };
  if (!token) return { state: 'pending', reason: 'GitHub publishing credential is missing.' };

  const task = JSON.parse(row.record);
  if (!validate(task) || task.state !== 'proposed' || task.owner_acceptance !== 'not_reviewed' || task.id !== taskId) {
    return { state: 'pending', reason: 'Stored proposal is not eligible for publication.' };
  }
  const document = JSON.stringify(task, null, 2) + '\n';
  const content = btoa(Array.from(new TextEncoder().encode(document), byte => String.fromCharCode(byte)).join(''));
  const endpoint = `https://api.github.com/repos/${repository}/contents/${directory}/${taskId}.json`;
  const options = {
    redirect: 'manual', signal: AbortSignal.timeout(8000),
    headers: {
      Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json', 'User-Agent': 'Aetherwake-Engineering-Observatory',
    },
  };
  try {
    const result = await fetcher(endpoint, {
      ...options, method: 'PUT',
      body: JSON.stringify({ message: 'Add proposed task ' + taskId, content, branch }),
    });
    await result.body?.cancel();
    if (result.status !== 201) {
      if (![409, 422].includes(result.status)) {
        return { state: 'pending', reason: 'GitHub could not save the proposal (HTTP ' + result.status + ').' };
      }
      // A prior attempt may have reached GitHub even if its response was lost.
      // Never overwrite a file. Confirm that an existing file is exactly ours.
      const existing = await fetcher(endpoint + '?ref=' + branch, options);
      if (!existing.ok) {
        await existing.body?.cancel();
        return { state: 'pending', reason: 'GitHub could not confirm the proposal file.' };
      }
      const file = JSON.parse(await readBounded(existing.body, 2 * TASK_REQUEST_MAX_BYTES));
      if (file.encoding !== 'base64' || file.content?.replace(/\s/g, '') !== content) {
        return { state: 'pending', reason: 'The existing GitHub file differs from this proposal.' };
      }
    }
    const receipt = { operation_id:crypto.randomUUID(), kind:'publish', target_id:taskId,
      actor:'github-publication', state:'published', at:new Date().toISOString() };
    await db.prepare(`UPDATE proposals SET github_state = 'published',
      receipts=json_insert(receipts,'$[#]',json(?))
      WHERE owner_id = ? AND namespace = 'live' AND task_id = ? AND github_state = 'pending'`)
      .bind(JSON.stringify(receipt), owner, taskId).run();
    return { state: 'published', url };
  } catch {
    return { state: 'pending', reason: 'GitHub did not confirm publication. You can retry the same proposal.' };
  }
}
