/** External trust boundary. Never load trust keys from an evidence bundle. */
import {createHash, verify} from 'node:crypto';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {resolve, relative, isAbsolute} from 'node:path';
export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function verifyReceipt(envelope, record, opts={}) {
  try {
    const p=envelope?.payload, trust=opts.trustStore?.[envelope?.key_id];
    if (!p || p.version!==1 || !trust || !Array.isArray(trust.roles)) return false;
    const role=p.type==='owner_acceptance'?'owner':p.type==='governance_scope'?'reviewer':(opts.requiredRole??'collector');
    if (!trust.roles.includes(role) || !verify(null,Buffer.from(canonical(p)),trust.public_key,Buffer.from(envelope.signature,'base64'))) return false;
    if (p.repository!==record.repository || p.task_id!==(record.task_id??record.id) || p.source_head!==record.revision || p.record_digest!==digest(record)) return false;
    if (!/^[a-f0-9]{40}$/.test(p.tested_revision??'') || (opts.testedRevision && p.tested_revision!==opts.testedRevision)) return false;
    if (opts.integrationRevision && p.integration_revision!==opts.integrationRevision) return false;
    const now=opts.now?Date.parse(opts.now):Date.now(), at=Date.parse(p.observed_at);
    if (!Number.isFinite(at)||at>now+300000||now-at>(opts.maxAgeHours??72)*3600000) return false;
    if (p.type==='governance_scope') return p.paths_digest===digest(opts.paths??[]) && Array.isArray(p.required_check_ids) && p.required_check_ids.every(x=>typeof x==='string'&&x.length>0);
    if (role==='owner') return p.decision==='accepted' && typeof p.actor==='string' && p.actor===trust.actor;
    if (p.type!=='execution' || p.result!=='passed' || p.attempt_id!==record.attempt_id || p.criterion_id!==record.criterion_id || p.artifact_uri!==record.artifact?.uri || p.synthetic!==false) return false;
    if (!opts.artifactRoot || typeof p.artifact_path!=='string' || isAbsolute(p.artifact_path)) return false;
    const root=realpathSync(opts.artifactRoot), file=realpathSync(resolve(root,p.artifact_path)), rel=relative(root,file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !statSync(file).isFile() || statSync(file).size>64*1024*1024) return false;
    return createHash('sha256').update(readFileSync(file)).digest('hex')===p.artifact_sha256;
  } catch { return false; }
}
