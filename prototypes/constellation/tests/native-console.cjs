const assert = require("node:assert/strict");

const CONSOLE_LIMITS = Object.freeze({ records: 32, recordBytes: 2048 });

function clipUtf8(value, bytes) {
  // Bound the temporary allocation too, without splitting a surrogate pair.
  let units = Math.min(value.length, bytes);
  if (
    units < value.length &&
    /[\uD800-\uDBFF]/.test(value[units - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(value[units] ?? "")
  )
    units--;
  const data = Buffer.from(value.slice(0, units), "utf8");
  if (data.length <= bytes) return data.toString("utf8");
  let end = bytes;
  while (end > 0 && (data[end] & 0xc0) === 0x80) end--;
  return data.subarray(0, end).toString("utf8");
}

function errorRecord(message, source, line, at) {
  const record = {
    event: "console-message",
    level: "error",
    message: clipUtf8(message, CONSOLE_LIMITS.recordBytes),
    source: typeof source === "string" ? clipUtf8(source, 256) : null,
    line: Number.isSafeInteger(line) && line >= 0 ? line : null,
    at,
  };
  while (
    Buffer.byteLength(JSON.stringify(record)) > CONSOLE_LIMITS.recordBytes
  ) {
    const excess =
      Buffer.byteLength(JSON.stringify(record)) - CONSOLE_LIMITS.recordBytes;
    record.message = clipUtf8(
      record.message,
      Math.max(0, Buffer.byteLength(record.message) - excess),
    );
  }
  return record;
}

/** Host and helper buffers overlap in time; their counts are never summed.
 * Includes verifier-generated scripts. Does not claim warning/log absence. */
function createNativeConsoleMonitor(contents, startupErrors, now = Date.now) {
  const registeredAt = new Date(now()).toISOString(),
    records = [];
  let observedErrors = 0,
    malformedEvents = 0,
    ignoredNonErrors = 0,
    disposedAt = null;
  const listener = (details) => {
    try {
      if (
        !details ||
        typeof details.level !== "string" ||
        typeof details.message !== "string"
      ) {
        malformedEvents++;
        return;
      }
      if (details.level !== "error") {
        ignoredNonErrors++;
        return;
      }
      observedErrors++;
      if (records.length < CONSOLE_LIMITS.records)
        records.push(
          errorRecord(
            details.message,
            details.sourceId,
            details.lineNumber,
            new Date(now()).toISOString(),
          ),
        );
    } catch {
      malformedEvents++;
    }
  };
  contents.on("console-message", listener);
  const snapshot = () => {
    const supplied = Array.isArray(startupErrors);
    let malformedStartupRecords = 0;
    const startup = supplied
      ? startupErrors.slice(-CONSOLE_LIMITS.records).flatMap((row) => {
          try {
            if (
              !row ||
              typeof row.message !== "string" ||
              (row.level !== undefined && row.level !== "error")
            ) {
              malformedStartupRecords++;
              return [];
            }
            return [
              errorRecord(
                row.message,
                row.source ?? row.sourceId,
                row.line ?? row.lineNumber,
                null,
              ),
            ];
          } catch {
            malformedStartupRecords++;
            return [];
          }
        })
      : null;
    return {
      scope:
        "Host-supplied pre-load error buffer as of snapshot; helper FIRST-details console-message level:error from registration through disposal. Includes verifier scripts. Overlapping buffers, not additive counts; non-error console diagnostics are not retained.",
      capturedAt: new Date(now()).toISOString(),
      limits: CONSOLE_LIMITS,
      startupSupplied: supplied,
      startupProvidedRecords: supplied ? startupErrors.length : null,
      startupAtCapacity: supplied
        ? startupErrors.length >= CONSOLE_LIMITS.records
        : null,
      malformedStartupRecords,
      startupErrors: startup,
      runtime: {
        registeredAt,
        disposedAt,
        observedErrors,
        discardedErrorRecords: observedErrors - records.length,
        malformedEvents,
        ignoredNonErrors,
        errors: records.map((row) => ({ ...row })),
      },
    };
  };
  return {
    snapshot,
    assertClean() {
      const state = snapshot();
      assert(
        state.startupSupplied,
        "native startup console errors are unobserved",
      );
      assert.equal(
        state.malformedStartupRecords + malformedEvents,
        0,
        "native console event signature/record is unrecognized",
      );
      assert.equal(
        state.startupErrors.length,
        0,
        "host recorded startup/runtime console errors",
      );
      assert.equal(observedErrors, 0, "helper recorded runtime console errors");
    },
    dispose() {
      if (disposedAt !== null) return;
      contents.removeListener("console-message", listener);
      disposedAt = new Date(now()).toISOString();
    },
  };
}

/** Standalone renderer read. Missing observations remain unknown. */
function frameCaptureHealth() {
  const state = window.__aerynth.snapshot();
  return {
    graphicsFailed: state.graphicsFailed ?? null,
    gpuFrames: state.gpu?.framesRendered ?? null,
    windowErrorCount: Array.isArray(state.metrics?.errors)
      ? state.metrics.errors.length
      : null,
  };
}

function assertFrameCaptureHealth(health, failureOnly = false) {
  assert.equal(
    health.graphicsFailed,
    false,
    "capture requires available graphics",
  );
  assert(
    Number.isFinite(health.gpuFrames) && health.gpuFrames > 0,
    "capture requires observed GPU draws",
  );
  if (!failureOnly)
    assert.equal(
      health.windowErrorCount,
      0,
      "passing capture requires no recorded window/runtime errors",
    );
}

module.exports = {
  CONSOLE_LIMITS,
  createNativeConsoleMonitor,
  frameCaptureHealth,
  assertFrameCaptureHealth,
};
