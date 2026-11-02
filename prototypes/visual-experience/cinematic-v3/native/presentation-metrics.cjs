const { createHash } = require("node:crypto");
const percentiles = (values) => {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: a.length,
    p50: a[Math.floor(a.length * 0.5)] ?? null,
    p95: a[Math.floor(a.length * 0.95)] ?? null,
    p99: a[Math.floor(a.length * 0.99)] ?? null,
  };
};
const numeric = (value) =>
  typeof value === "string" && value.trim() ? Number(value) : NaN;
/** Never adds multiple swap chains together or substitutes callback timing. */
function summarizePresentMon(csv, targetPid) {
  const lines = csv.trim().split(/\r?\n/),
    header =
      lines
        .shift()
        ?.replace(/^\uFEFF/, "")
        .split(",")
        .map((name) => {
          const canonical = {
            processid: "ProcessID",
            swapchainaddress: "SwapChainAddress",
            dropped: "Dropped",
            presentmode: "PresentMode",
            msbetweendisplaychange: "MsBetweenDisplayChange",
            msuntildisplayed: "MsUntilDisplayed",
          };
          return canonical[name.trim().toLowerCase()] ?? name.trim();
        }) ?? [];
  if (
    ![
      "ProcessID",
      "SwapChainAddress",
      "Dropped",
      "MsBetweenDisplayChange",
    ].every((k) => header.includes(k))
  )
    return {
      qualified: false,
      reason: "required_display_columns_absent",
      columns: header,
    };
  const rows = lines
    .filter(Boolean)
    .map((line) =>
      Object.fromEntries(
        line
          .split(",")
          .map((value, i) => [header[i], value.replace(/^"|"$/g, "")]),
      ),
    )
    .filter((row) => Number(row.ProcessID) === targetPid);
  const groups = new Map();
  for (const row of rows) {
    const key = row.SwapChainAddress;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(row);
  }
  const swapchains = [...groups]
    .map(([key, frames]) => {
      const displayed = frames.filter(
        (f) => f.Dropped === "0" && Number(f.MsBetweenDisplayChange) > 0,
      );
      return {
        id: createHash("sha256").update(key).digest("hex").slice(0, 12),
        frames: frames.length,
        displayedFrames: displayed.length,
        droppedFrames: frames.filter((f) => f.Dropped === "1").length,
        presentModes: [...new Set(frames.map((f) => f.PresentMode))],
        displayIntervalsMs: percentiles(
          displayed.map((f) => numeric(f.MsBetweenDisplayChange)),
        ),
        presentToDisplayMs: percentiles(
          displayed.map((f) => numeric(f.MsUntilDisplayed)),
        ),
      };
    })
    .sort((a, b) => b.displayedFrames - a.displayedFrames);
  return {
    qualified: swapchains.some((s) => s.displayedFrames >= 30),
    meaning:
      "ETW display-change intervals reported for this application GPU process; separate swap chains, no callback-derived FPS",
    totalTargetFrames: rows.length,
    swapchains,
  };
}
module.exports = { percentiles, summarizePresentMon };
