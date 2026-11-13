// Called only by the admitted native parent. No renderer command or child
// launch is registered here. The host must implement the restart descriptor.
async function prepareMemoryInspectorRestart({ check, worker, protector }) {
  check();
  await worker.close();
  check();
  worker.assertWorkerExited();
  const restart = await protector.prepareRestart({
    check,
    assertWorkerExited: () => worker.assertWorkerExited(),
  });
  try {
    check();
    return restart;
  } catch (error) {
    restart.close();
    throw error;
  }
}

module.exports = { prepareMemoryInspectorRestart };
