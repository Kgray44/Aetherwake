// Only a routine send may continue without an optional memory lookup.
const unavailable = new Set([
  "private_key_unavailable", "private_key_missing", "private_crypto_unavailable", "personal_memory_native_required",
]);
const misses = new Set(["personal_memory_no_eligible_context", "personal_memory_search_incomplete"]);

const codeOf = error => error?.code ?? error?.message;
const memoryRecallUnavailable = error => unavailable.has(codeOf(error));
const canSkipOptionalMemory = error => memoryRecallUnavailable(error) || misses.has(codeOf(error));

module.exports = { memoryRecallUnavailable, canSkipOptionalMemory };
