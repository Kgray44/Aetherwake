const operations = [
  "validate retained checkout", "resume existing checkout", "allocate staging directory",
  "initialize repository", "configure long paths", "fetch from cache",
  "fetch from configured origin", "verify pinned commit", "set repository origin",
  "set Git author name", "set Git author email", "materialize pinned branch",
  "verify materialized checkout", "publish staged checkout", "prepare checkout",
];
const categories = [
  "operation_failed", "timeout", "incomplete_cache",
  "authentication", "revision_unavailable", "temporary_transport",
  "git_lock_contention", "filesystem_access", "storage_exhausted",
  "reconciliation_required", "original_checkout_missing", "identity_mismatch",
];
const stages = ['checkout_provisioning','checkout_fetch','checkout_materialization'];
export const checkoutDiagnosticSchema = {
  type:'object',additionalProperties:false,
  required:['stage','operation','category','retryable','duration_ms','recovery_required'],
  properties:{
    stage:{enum:stages},
    operation:{enum:operations},
    category:{enum:categories},
    retryable:{type:'boolean'},
    duration_ms:{type:'integer',minimum:0,maximum:1_800_000},
    recovery_required:{type:'boolean'},
    exit_code:{type:'integer',minimum:0,maximum:255},
    fetch_attempts:{type:'integer',minimum:1,maximum:3},
  },
};

export function validCheckoutDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const {required,properties}=checkoutDiagnosticSchema;
  if (!required.every(key=>Object.hasOwn(value,key))) return false;
  return Object.entries(value).every(([key,item])=>{
    if (!Object.hasOwn(properties,key)) return false;
    const rule=properties[key];
    if (rule.enum) return rule.enum.includes(item);
    if (rule.type==='boolean') return typeof item==='boolean';
    return Number.isSafeInteger(item)&&item>=rule.minimum&&item<=rule.maximum;
  });
}
