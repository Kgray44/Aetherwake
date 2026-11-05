const { randomUUID } = require("node:crypto");

const scheme = "aerynth-media";
const prefix = `${scheme}://video/`;
const idPattern = /^[a-f0-9-]{36}$/;
const videoTypes = new Set(["video/mp4", "video/webm", "video/ogg"]);
const chunkBytes = 256 * 1024;

function byteRange(header, size) {
  if (header === null) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d{0,16})-(\d{0,16})$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] === "" ? null : Number(match[1]);
  const last = match[2] === "" ? null : Number(match[2]);
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last)) ||
    (first === null && last === 0)
  )
    return null;
  const start = first ?? Math.max(0, size - last);
  const end =
    first === null || last === null ? size - 1 : Math.min(last, size - 1);
  return start <= end ? { start, end, status: 206 } : null;
}

function createMediaPlayback({ call, ownerAlive }) {
  const leases = new Map();
  let pending = 0;
  let streams = 0;
  let epoch = 0;

  async function acquire(input) {
    const { resourceId, expectedVersion, sourceRevision, intent } = input;
    if (
      Object.keys(input).length !== 4 ||
      intent !== "local-video" ||
      typeof resourceId !== "string" ||
      !Number.isSafeInteger(expectedVersion) ||
      typeof sourceRevision !== "string"
    )
      throw Error("unsupported_media_operation");
    if (leases.size + pending >= 8) throw Error("media_playback_busy");
    const scope = {
      resourceId,
      expectedVersion,
      sourceRevision,
      playback: true,
    };
    const expectedEpoch = epoch;
    pending++;
    try {
      const { metadata, capabilities } = await call("mediaDescribe", {
        resourceId,
      });
      if (
        !capabilities.play ||
        metadata.source !== "file" ||
        metadata.format !== "video" ||
        !videoTypes.has(metadata.mime) ||
        !Number.isSafeInteger(metadata.byteLength) ||
        metadata.byteLength < 1
      )
        throw Error("unsupported_media_operation");
      // Recheck the canonical version and the selected file before minting a URL.
      await call("mediaReadChunk", { ...scope, offset: 0, length: 1 });
      if (!ownerAlive() || epoch !== expectedEpoch)
        throw Error("media_source_unavailable");
      const leaseId = randomUUID();
      leases.set(leaseId, { scope, metadata, stops: new Set() });
      return {
        leaseId,
        src: prefix + leaseId,
        kind: "local-video",
        mime: metadata.mime,
      };
    } finally {
      pending--;
    }
  }

  function release(leaseId) {
    const lease = leases.get(leaseId);
    leases.delete(leaseId);
    for (const stop of lease?.stops ?? []) stop();
  }

  function clear() {
    epoch++;
    for (const id of leases.keys()) release(id);
  }

  function handle(request) {
    const leaseId = request.url.startsWith(prefix)
      ? request.url.slice(prefix.length)
      : "";
    const lease = idPattern.test(leaseId) && leases.get(leaseId);
    if (!lease || !ownerAlive() || request.signal.aborted)
      return new Response(null, { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 });
    const { metadata, scope } = lease;
    const range = byteRange(request.headers.get("range"), metadata.byteLength);
    if (!range)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${metadata.byteLength}` },
      });
    const { start, end, status } = range;
    const headers = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(end - start + 1),
      "Content-Type": metadata.mime,
      "X-Content-Type-Options": "nosniff",
      ...(status === 206
        ? { "Content-Range": `bytes ${start}-${end}/${metadata.byteLength}` }
        : {}),
    };
    if (request.method === "HEAD")
      return new Response(null, { status, headers });
    if (streams >= 8 || lease.stops.size >= 3)
      return new Response(null, { status: 503 });

    let offset = start,
      controller,
      done = false;
    function finish() {
      if (done) return;
      done = true;
      streams--;
      lease.stops.delete(stop);
      request.signal.removeEventListener("abort", stop);
    }
    function stop() {
      if (done) return;
      finish();
      controller.error(Error("media_stream_closed"));
    }
    const body = new ReadableStream(
      {
        start(value) {
          controller = value;
          streams++;
          lease.stops.add(stop);
          request.signal.addEventListener("abort", stop, { once: true });
        },
        async pull() {
          try {
            const length = Math.min(chunkBytes, end - offset + 1);
            const { base64 } = await call("mediaReadChunk", {
              ...scope,
              offset,
              length,
            });
            if (done) return;
            if (
              !ownerAlive() ||
              typeof base64 !== "string" ||
              base64.length !== 4 * Math.ceil(length / 3)
            )
              throw Error("media_source_unavailable");
            const bytes = Buffer.from(base64, "base64");
            if (bytes.byteLength !== length) throw Error("source_changed");
            controller.enqueue(bytes);
            offset += length;
            if (offset > end) {
              controller.close();
              finish();
            }
          } catch {
            stop();
          }
        },
        cancel: finish,
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status, headers });
  }

  return { acquire, release, clear, handle };
}

module.exports = { createMediaPlayback, scheme };
