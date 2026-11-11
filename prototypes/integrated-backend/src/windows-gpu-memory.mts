import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const adapterLimit = 64;
const luidPattern = /^[0-9a-f]{8}_[0-9a-f]{8}$/iu;
const counterPattern = /^luid_0x([0-9a-f]{8})_0x([0-9a-f]{8})_phys_(\d+)$/iu;
const byteCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

export type DedicatedMemoryEstimate = {
  gpuDedicatedCapacityBytes: number;
  gpuDedicatedInUseBytes: number;
  vramAvailableBytes: number;
};

/** Select a single matched adapter. Linked, duplicated and inconsistent observations cannot supply a value. */
export function estimateDedicatedHeadroom(capacities: unknown, counters: unknown): DedicatedMemoryEstimate | undefined {
  if (!Array.isArray(capacities) || capacities.length > adapterLimit || !Array.isArray(counters) || counters.length > adapterLimit)
    return;
  const capacityByLuid = new Map<string, number | null>();
  for (const row of capacities) {
    if (!record(row) || typeof row.luid !== 'string' || !luidPattern.test(row.luid) || !byteCount(row.bytes) || row.bytes === 0) continue;
    const key = row.luid.toLowerCase();
    capacityByLuid.set(key, capacityByLuid.has(key) ? null : row.bytes);
  }
  const usageByLuid = new Map<string, number | null>();
  for (const row of counters) {
    if (!record(row) || typeof row.Name !== 'string') continue;
    const match = counterPattern.exec(row.Name);
    if (!match) continue;
    const key = `${match[1]}_${match[2]}`.toLowerCase();
    usageByLuid.set(key, match[3] === '0' && !usageByLuid.has(key) && byteCount(row.DedicatedUsage) ?
      row.DedicatedUsage : null);
  }
  let best: DedicatedMemoryEstimate | undefined;
  for (const [key, capacity] of capacityByLuid) {
    const usage = usageByLuid.get(key);
    if (capacity === null || usage === null || usage === undefined || usage > capacity) continue;
    const headroom = capacity - usage;
    if (!best || headroom > best.vramAvailableBytes)
      best = { gpuDedicatedCapacityBytes: capacity, gpuDedicatedInUseBytes: usage, vramAvailableBytes: headroom };
  }
  return best;
}

// DXGI 1.1 uses native SIZE_T capacity and an adapter LUID. Exclude software adapters
// and return no adapter names or per-process information.
const capacityScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class AerynthDxgiMemory {
    [StructLayout(LayoutKind.Sequential)]
    private struct Luid {
        public uint Low;
        public int High;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Description {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
        public uint VendorId, DeviceId, SubsystemId, Revision;
        public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public Luid Adapter;
        public uint Flags;
    }

    public sealed class Capacity {
        public string luid { get; set; }
        public ulong bytes { get; set; }
    }

    [DllImport("dxgi.dll", ExactSpelling = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EnumAdapters1(IntPtr self, uint index, out IntPtr adapter);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDesc1(IntPtr self, out Description description);

    private static T Method<T>(IntPtr instance, int slot) where T : class {
        IntPtr table = Marshal.ReadIntPtr(instance);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), typeof(T)) as T;
    }

    public static Capacity[] Read() {
        Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        IntPtr factory;
        Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
        try {
            // Slots include IUnknown, IDXGIObject and the inherited DXGI interfaces.
            EnumAdapters1 enumerate = Method<EnumAdapters1>(factory, 12);
            var result = new List<Capacity>();
            for (uint index = 0; index <= 64; index++) {
                IntPtr adapter;
                int status = enumerate(factory, index, out adapter);
                if (status == unchecked((int)0x887A0002)) return result.ToArray();
                Marshal.ThrowExceptionForHR(status);
                try {
                    if (index == 64) throw new InvalidOperationException("DXGI adapter limit");
                    Description description;
                    Marshal.ThrowExceptionForHR(Method<GetDesc1>(adapter, 10)(adapter, out description));
                    ulong bytes = description.DedicatedVideoMemory.ToUInt64();
                    if ((description.Flags & 2) == 0 && bytes > 0) {
                        result.Add(new Capacity {
                            luid = unchecked((uint)description.Adapter.High).ToString("x8") + "_" + description.Adapter.Low.ToString("x8"),
                            bytes = bytes
                        });
                    }
                } finally { Marshal.Release(adapter); }
            }
            throw new InvalidOperationException("DXGI enumeration did not terminate");
        } finally { Marshal.Release(factory); }
    }
}
'@
ConvertTo-Json -InputObject @([AerynthDxgiMemory]::Read()) -Compress
`;

export async function readWindowsGpuCapacities(powershell: string, signal: AbortSignal): Promise<unknown> {
  const { stdout } = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', capacityScript],
    { windowsHide: true, timeout: 12_000, maxBuffer: 16 * 1024, encoding: 'utf8', signal });
  return JSON.parse(stdout);
}

/** Adapter capacity is static within a LUID. Retry slowly after probe failure. */
export function createWindowsGpuCapacityCache() {
  let capacities: unknown;
  let expiresAt = -Infinity, retryAt = -Infinity;
  return {
    async get(powershell: string, signal: AbortSignal) {
      const now = performance.now();
      if (now < expiresAt) return capacities;
      if (now < retryAt) return;
      retryAt = now + 60_000;
      const reading = await readWindowsGpuCapacities(powershell, signal).catch(() => undefined);
      if (!signal.aborted && Array.isArray(reading) && reading.length <= adapterLimit) {
        capacities = reading;
        expiresAt = now + 300_000;
        return capacities;
      }
    },
    reset() { capacities = undefined; expiresAt = retryAt = -Infinity; },
  };
}
