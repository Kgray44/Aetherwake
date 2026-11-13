const { spawnSync } = require('node:child_process');
const { realpathSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');
const { createAdmission, desktopDirectory } = require('./native-test-admission.cjs');
const { memoryWitnessDeadline, memoryWitnessRoot } = require('./personal-memory-review-guard.cjs');

function launchMemoryWitness({ profileRoot, mode, electronPath, env = process.env,
  locateDesktop = desktopDirectory, openAdmission = createAdmission,
  resolveElectron = realpathSync, spawnElectron = spawnSync }) {
  const directory = locateDesktop();
  if (!directory) throw Error('native_test_desktop_slot_requires_windows');
  const admission = openAdmission(directory);
  const token = env.AERYNTH_NATIVE_TEST_SLOT;
  const check = () => {
    const permit = admission.checkPermit(token);
    if (admission.status().lease) throw Error('native_test_desktop_slot_busy');
    return permit;
  };
  const permit = check();
  if (!['save', 'restore'].includes(mode)) throw Error('native_memory_invalid_phase');
  const phase = { purpose: 'synthetic-memory-review', mode, profileRoot,
    expiresAt: Math.min(Date.now() + 45_000, permit.expiresAt) };
  memoryWitnessDeadline(phase, mode);
  const root = memoryWitnessRoot(phase, profileRoot);
  if (typeof electronPath !== 'string' || !isAbsolute(electronPath)) throw Error('native_memory_electron_path_required');
  const executable = resolveElectron(electronPath);
  const childEnv = { ...env, AERYNTH_MEMORY_WITNESS_ADMISSION: JSON.stringify(phase) };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  check();
  const remaining = Math.ceil(memoryWitnessDeadline(phase, mode) - performance.now());
  const result = spawnElectron(executable, [join(__dirname, 'personal-memory-native-verify.cjs'), root, mode],
    { env: childEnv, windowsHide: true, stdio: 'inherit', timeout: Math.max(1, remaining) + 3_000 });
  if (result.error || result.status === null) throw Error('native_memory_witness_process_failed');
  if (admission.status().lease) throw Error('native_test_desktop_slot_busy');
  return result.status;
}

if (require.main === module) {
  const [electronPath, profileRoot, mode] = process.argv.slice(2);
  try { process.exitCode = launchMemoryWitness({ electronPath, profileRoot, mode }); }
  catch (error) {
    console.error(error.code ?? error.message);
    process.exitCode = 2;
  }
}

module.exports = { launchMemoryWitness };
