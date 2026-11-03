const assert = require("node:assert/strict");
const test = require("node:test");
const { createMediaPlayback } = require("../native/media-playback.cjs");

const size = 600_000;
const scope = {
  resourceId: "synthetic-video",
  expectedVersion: 3,
  sourceRevision: "revision",
};

function fixture() {
  const reads = [];
  let revoked = false;
  const playback = createMediaPlayback({
    ownerAlive: () => true,
    async call(name, input) {
      if (name === "mediaDescribe")
        return {
          metadata: {
            source: "file",
            format: "video",
            mime: "video/webm",
            byteLength: size,
          },
          capabilities: { play: true },
        };
      assert.equal(name, "mediaReadChunk");
      assert.deepEqual(input, {
        ...scope,
        playback: true,
        offset: input.offset,
        length: input.length,
      });
      reads.push([input.offset, input.length]);
      if (revoked) throw Error("source_changed");
      return {
        base64: Buffer.alloc(input.length, input.offset % 251).toString(
          "base64",
        ),
      };
    },
  });
  return {
    ...playback,
    reads,
    revoke() {
      revoked = true;
    },
  };
}

test("local video leases provide bounded, seekable canonical reads and release their URL", async () => {
  const media = fixture();
  const lease = await media.acquire({ ...scope, intent: "local-video" });
  assert.equal(lease.src, `aerynth-media://video/${lease.leaseId}`);
  const tail = media.handle(
    new Request(lease.src, { headers: { Range: "bytes=-20" } }),
  );
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get("content-range"), "bytes 599980-599999/600000");
  assert.deepEqual(
    Buffer.from(await tail.arrayBuffer()),
    Buffer.alloc(20, 599980 % 251),
  );
  const full = media.handle(new Request(lease.src));
  assert.equal(full.status, 200);
  assert.equal((await full.arrayBuffer()).byteLength, size);
  assert.deepEqual(media.reads, [
    [0, 1],
    [599980, 20],
    [0, 262144],
    [262144, 262144],
    [524288, 75712],
  ]);
  for (const range of [
    "bytes=0-1,4-6",
    "bytes=-0",
    "bytes=600000-",
    "bytes=8-4",
  ])
    assert.equal(
      media.handle(new Request(lease.src, { headers: { Range: range } }))
        .status,
      416,
    );
  assert.equal(media.handle(new Request(`${lease.src}?extra=1`)).status, 404);
  media.release(lease.leaseId);
  assert.equal(media.handle(new Request(lease.src)).status, 404);
});

test("a changed source or a released player cannot continue an in-flight stream", async () => {
  const media = fixture();
  const input = { ...scope, intent: "local-video" };
  const one = await media.acquire(input),
    two = await media.acquire(input);
  const reading = media.handle(new Request(one.src)).body.getReader();
  assert.equal((await reading.read()).value.byteLength, 262144);
  media.revoke();
  await assert.rejects(reading.read(), /media_stream_closed/);
  const pending = media.handle(new Request(two.src)).body.getReader();
  media.clear();
  await assert.rejects(pending.read(), /media_stream_closed/);
  assert.equal(media.handle(new Request(two.src)).status, 404);
  await assert.rejects(media.acquire(input), /source_changed/);
});
