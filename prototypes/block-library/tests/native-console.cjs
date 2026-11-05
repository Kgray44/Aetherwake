/** Electron 45 WebContents delivers the details Event as its FIRST argument.
 * The second argument is a deprecated numeric level, not another details object. */
exports.consoleErrorHandler = receipt => details => {
  if (details?.level !== 'error' || receipt.errors.length >= 20) return;
  const record = {
    message: String(details.message ?? '').slice(0, 1000),
    sourceId: String(details.sourceId ?? '').slice(0, 1000),
    ...(Number.isInteger(details.lineNumber) ? { lineNumber: details.lineNumber } : {}),
  };
  receipt.errors.push(record.message);
  (receipt.consoleErrors ??= []).push(record);
};
