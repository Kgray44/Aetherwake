/** Finite component-test deadline. It controls no foreground/native input. */
exports.beforeDeadline = async (deadlineAt, stage, work, now = Date.now) => {
  const error = () =>
    Object.assign(new Error("DOM check deadline at " + stage), {
      code: "DOM_CHECK_DEADLINE",
      stage,
    });
  const remaining = deadlineAt - now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw error();
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(work),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(error()), remaining);
      }),
    ]);
    if (now() >= deadlineAt) throw error();
    return value;
  } finally {
    clearTimeout(timer);
  }
};
