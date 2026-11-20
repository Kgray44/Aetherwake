const hash = /^[a-f0-9]{64}$/;
const label = /^[A-Za-z0-9_.:-]{1,100}$/;
const path = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}$/;
const metrics = ['input_tokens','cached_input_tokens','output_tokens','total_tokens','commands','turn_ms'];

function exactFields(value, fields, optional = []) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    fields.every(field => Object.hasOwn(value,field)) &&
    Object.keys(value).every(field => fields.includes(field)||optional.includes(field));
}

function validArm(arm) {
  return exactFields(arm,['receipt_sha256',...metrics]) && typeof arm.receipt_sha256==='string' &&
    hash.test(arm.receipt_sha256) && metrics.every(key=>Number.isSafeInteger(arm[key])&&arm[key]>=0) &&
    arm.cached_input_tokens<=arm.input_tokens && arm.total_tokens===arm.input_tokens+arm.output_tokens;
}

export function validMatchedBenchmark(value) {
  return exactFields(value,['source_revision','artifact_sha256','provider','model','standard','compact'],['artifact_path']) &&
    typeof value.source_revision==='string' && /^[a-f0-9]{40}$/.test(value.source_revision) &&
    (!Object.hasOwn(value,'artifact_path') ||
      (typeof value.artifact_path==='string' && value.artifact_path.length<=240 && path.test(value.artifact_path))) &&
    typeof value.artifact_sha256==='string' && hash.test(value.artifact_sha256) &&
    typeof value.provider==='string' && label.test(value.provider) && typeof value.model==='string' && label.test(value.model) &&
    validArm(value.standard) && validArm(value.compact) && value.standard.receipt_sha256!==value.compact.receipt_sha256;
}
