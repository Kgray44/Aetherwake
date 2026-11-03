/** One asynchronous reserve observation at a time. A failed probe pauses
 * writes until another actual observation admits them. */
exports.createStorageAdmission = ({ probe, initiallyAdmitted, changed, now = () => performance.now() }) => {
  let admitted = initiallyAdmitted === true;
  let pending = null;
  let nextDemandAt = 0;
  function recheck() {
    if (pending) return pending;
    pending = Promise.resolve().then(probe).catch(() => false).then((result) => {
      const before = admitted;
      admitted = result === true;
      if (before !== admitted) changed(admitted);
      return admitted;
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    recheck,
    async allowWrite() {
      if (pending) return pending;
      if (admitted) return true;
      if (now() < nextDemandAt) return false;
      nextDemandAt = now() + 15000;
      return recheck();
    },
  };
};
