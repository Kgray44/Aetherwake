import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { GpuProcessBudget, ResourceLease } from './resource-policy.mts';
import { dxgiCapacityInterop } from './windows-gpu-memory.mts';

export const gpuReadbackReservationBytes = 256 * 2 ** 20;
export const gpuReadbackRamReservationBytes = 64 * 2 ** 20;
const verifiedBuffers = 8;
const bufferBytes = 16 * 2 ** 20;
const allocatedBytes = verifiedBuffers * bufferBytes;

export type WindowsGpuReadback = {
  budgetBytes: number;
  beforeBytes: number;
  heldBytes: number;
  releasedBytes: number;
  allocatedBytes: number;
  allocationMs: number;
  readbackMs: number;
  verifiedBuffers: number;
};

const workerInterop = String.raw`
public static partial class AerynthDxgiMemory {

    [StructLayout(LayoutKind.Sequential)]
    private struct VideoMemoryInfo { public ulong Budget, CurrentUsage, AvailableForReservation, CurrentReservation; }
    [StructLayout(LayoutKind.Sequential)]
    private struct BufferDesc { public uint ByteWidth, Usage, BindFlags, CpuAccessFlags, MiscFlags, StructureByteStride; }
    [StructLayout(LayoutKind.Sequential)]
    private struct InitData { public IntPtr Source; public uint Pitch, SlicePitch; }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int QueryMemory(IntPtr self, uint node, uint segment, out VideoMemoryInfo memory);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int CreateBuffer(IntPtr self, ref BufferDesc desc, ref InitData data, out IntPtr buffer);
    [StructLayout(LayoutKind.Sequential)]
    private struct Mapped { public IntPtr Data; public uint RowPitch, DepthPitch; }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int CreateEmptyBuffer(IntPtr self, ref BufferDesc desc, IntPtr data, out IntPtr buffer);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate void CopyResource(IntPtr self, IntPtr dest, IntPtr src);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int MapRead(IntPtr self, IntPtr resource, uint subresource, uint mode, uint flags, out Mapped result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate void Unmap(IntPtr self, IntPtr resource, uint subresource);
    [DllImport("d3d11.dll", ExactSpelling = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern int D3D11CreateDevice(IntPtr adapter, uint driver, IntPtr software, uint flags,
        IntPtr levels, uint levelCount, uint sdk, out IntPtr device, out uint feature, out IntPtr context);
    [DllImport("kernel32.dll", ExactSpelling = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", ExactSpelling = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    public sealed class ExerciseResult {
        public ulong budgetBytes { get; set; }
        public ulong beforeBytes { get; set; }
        public ulong heldBytes { get; set; }
        public ulong releasedBytes { get; set; }
        public uint allocatedBytes { get; set; }
        public long allocationMs { get; set; }
        public long readbackMs { get; set; }
        public int verifiedBuffers { get; set; }
    }
    public static ExerciseResult RunVerifiedCopy() {
        // Bound native driver work even if the Node lease timer no longer exists.
        using (var watchdog = new System.Threading.Timer(delegate { TerminateProcess(GetCurrentProcess(), 75); }, null, 12000, -1)) {
            return CopyUnderLease();
        }
    }
    private static ExerciseResult CopyUnderLease() {
        Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        IntPtr factory, selected = IntPtr.Zero, adapter3 = IntPtr.Zero, device = IntPtr.Zero, context = IntPtr.Zero, initial = IntPtr.Zero;
        var buffers = new List<IntPtr>();
        Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
        try {
            ulong largest = 0;
            EnumAdapters1 enumerate = Method<EnumAdapters1>(factory, 12);
            for (uint index=0; index<64; index++) {
                IntPtr adapter;
                int status = enumerate(factory, index, out adapter);
                if (status == unchecked((int)0x887A0002)) break;
                Marshal.ThrowExceptionForHR(status);
                try {
                    Description desc;
                    Marshal.ThrowExceptionForHR(Method<GetDesc1>(adapter, 10)(adapter, out desc));
                    ulong bytes = desc.DedicatedVideoMemory.ToUInt64();
                    if ((desc.Flags & 2) == 0 && bytes > largest) {
                        if (selected != IntPtr.Zero) Marshal.Release(selected);
                        largest = bytes;
                        selected = adapter;
                        adapter = IntPtr.Zero;
                    }
                } finally { if (adapter != IntPtr.Zero) Marshal.Release(adapter); }
            }
            if (selected == IntPtr.Zero) throw new InvalidOperationException("No dedicated hardware adapter");
            Guid adapter3Id = new Guid("645967a4-1392-4310-a798-8053ce3e93fd");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(selected, ref adapter3Id, out adapter3));
            uint feature;
            Marshal.ThrowExceptionForHR(D3D11CreateDevice(selected, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, 7,
                out device, out feature, out context));
            var query = Method<QueryMemory>(adapter3, 14);
            VideoMemoryInfo before, held, released;
            Marshal.ThrowExceptionForHR(query(adapter3, 0, 0, out before));
            Console.WriteLine(String.Format(System.Globalization.CultureInfo.InvariantCulture,
                "{{\"kind\":\"ready\",\"budgetBytes\":{0},\"usedBytes\":{1}}}", before.Budget, before.CurrentUsage));
            if (Console.ReadLine() != "run") throw new InvalidOperationException("GPU lease not granted");
            // The parent keeps stdin open while it owns the lease. EOF or an unexpected command ends the process.
            var leaseWatcher = new System.Threading.Thread(delegate() {
                try { Console.ReadLine(); }
                finally { TerminateProcess(GetCurrentProcess(), 74); }
            });
            leaseWatcher.IsBackground = true;
            leaseWatcher.Start();
            Console.WriteLine("{\"kind\":\"started\"}");
            Action checkBudget = delegate {
                VideoMemoryInfo current;
                Marshal.ThrowExceptionForHR(query(adapter3, 0, 0, out current));
                if (current.Budget <= current.CurrentUsage || current.Budget - current.CurrentUsage < ${gpuReadbackReservationBytes}UL)
                    throw new InvalidOperationException("GPU process budget declined");
            };
            checkBudget();
            const int chunkBytes=${bufferBytes}, count=${verifiedBuffers};
            var bytesToUpload = new byte[chunkBytes];
            new Random(2026).NextBytes(bytesToUpload);
            initial = Marshal.AllocHGlobal(chunkBytes);
            Marshal.Copy(bytesToUpload,0,initial,chunkBytes);
            var create = Method<CreateBuffer>(device, 3);
            var descBuffer = new BufferDesc { ByteWidth=chunkBytes, Usage=1, BindFlags=1 };
            var data = new InitData { Source=initial };
            var elapsed = System.Diagnostics.Stopwatch.StartNew();
            for (byte index=0; index<count; index++) {
                checkBudget();
                Marshal.WriteByte(initial,index);
                IntPtr buffer;
                Marshal.ThrowExceptionForHR(create(device,ref descBuffer,ref data,out buffer));
                buffers.Add(buffer);
            }
            elapsed.Stop();
            long uploadMs = elapsed.ElapsedMilliseconds;
            int verified = 0;
            IntPtr staging;
            var stagingDesc = new BufferDesc { ByteWidth=chunkBytes, Usage=3, CpuAccessFlags=0x20000 };
            checkBudget();
            Marshal.ThrowExceptionForHR(Method<CreateEmptyBuffer>(device,3)(device,ref stagingDesc,IntPtr.Zero,out staging));
            try {
                var copy = Method<CopyResource>(context,47);
                var map = Method<MapRead>(context,14);
                var unmap = Method<Unmap>(context,15);
                var readback = new byte[chunkBytes];
                using (var sha=System.Security.Cryptography.SHA256.Create()) {
                    elapsed.Restart();
                    for (int i=0;i<buffers.Count;i++) {
                        checkBudget();
                        copy(context,staging,buffers[i]);
                        Mapped mapped;
                        Marshal.ThrowExceptionForHR(map(context,staging,0,1,0,out mapped));
                        try { Marshal.Copy(mapped.Data,readback,0,chunkBytes); }
                        finally { unmap(context,staging,0); }
                        bytesToUpload[0]=(byte)i;
                        if (Convert.ToBase64String(sha.ComputeHash(readback)) != Convert.ToBase64String(sha.ComputeHash(bytesToUpload)))
                            throw new InvalidOperationException("GPU readback mismatch");
                        verified++;
                    }
                    elapsed.Stop();
                }
            } finally { Marshal.Release(staging); }
            System.Threading.Thread.Sleep(250);
            Marshal.ThrowExceptionForHR(query(adapter3, 0, 0, out held));
            foreach (IntPtr buffer in buffers) Marshal.Release(buffer);
            buffers.Clear();
            System.Threading.Thread.Sleep(250);
            Marshal.ThrowExceptionForHR(query(adapter3, 0, 0, out released));
            return new ExerciseResult { budgetBytes=held.Budget, beforeBytes=before.CurrentUsage, heldBytes=held.CurrentUsage,
                releasedBytes=released.CurrentUsage, allocatedBytes=chunkBytes*count, allocationMs=uploadMs,readbackMs=elapsed.ElapsedMilliseconds,verifiedBuffers=verified };
        } finally {
            foreach (IntPtr buffer in buffers) Marshal.Release(buffer);
            if (initial != IntPtr.Zero) Marshal.FreeHGlobal(initial);
            if (context != IntPtr.Zero) Marshal.Release(context);
            if (device != IntPtr.Zero) Marshal.Release(device);
            if (adapter3 != IntPtr.Zero) Marshal.Release(adapter3);
            if (selected != IntPtr.Zero) Marshal.Release(selected);
            Marshal.Release(factory);
        }
    }
}
`;
const workerScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${dxgiCapacityInterop}
${workerInterop}
'@
$receipt = [AerynthDxgiMemory]::RunVerifiedCopy()
ConvertTo-Json -InputObject @{kind='result'; value=$receipt} -Compress
`;

export function verifiedGpuReadback(input: unknown): input is WindowsGpuReadback {
  if (!input || typeof input !== 'object') return false;
  const row = input as Record<string, unknown>;
  const validNumber = (key: string) => typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && Number(row[key]) >= 0;
  return row.allocatedBytes === allocatedBytes && row.verifiedBuffers === verifiedBuffers &&
    ['budgetBytes', 'beforeBytes', 'heldBytes', 'releasedBytes', 'allocationMs', 'readbackMs'].every(validNumber);
}

/** One private, read-only diagnostic. Only an admitted lease can start device allocations. */
export function openWindowsGpuReadback() {
  const root = process.env.SystemRoot;
  if (platform() !== 'win32' || !root || !isAbsolute(root)) throw Error('windows_gpu_worker_unavailable');
  const executable = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Keep the child attached so libuv's Windows process job can also clean it up on host exit.
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', workerScript],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const contextId = randomUUID();
  let resolveBudget!: (value: GpuProcessBudget) => void, rejectBudget!: (error: Error) => void;
  let resolveStarted!: (value: boolean) => void;
  const ready = new Promise<GpuProcessBudget>((resolve, reject) => {
    resolveBudget = resolve;
    rejectBudget = reject;
  });
  void ready.catch(() => {});
  const started = new Promise<boolean>(resolve => { resolveStarted = resolve; });
  let budget: GpuProcessBudget | undefined, result: WindowsGpuReadback | undefined;
  let claimed = false, acknowledged = false, buffer = '';
  const stop = () => { if (child.exitCode === null && !child.killed) child.kill(); };
  let deadline = setTimeout(stop, 20_000).unref();
  const ended = new Promise<number | null>(resolve => child.once('close', code => {
    clearTimeout(deadline);
    if (!budget) rejectBudget(Error('windows_gpu_worker_unavailable'));
    resolveStarted(false);
    resolve(code);
  }));
  child.on('error', () => rejectBudget(Error('windows_gpu_worker_unavailable')));
  child.stdin.on('error', stop);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 8192) { stop(); return; }
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      let message: { kind?: string; budgetBytes?: unknown; usedBytes?: unknown; value?: unknown };
      try { message = JSON.parse(line); } catch { stop(); return; }
      if (message?.kind === 'ready' && !budget && typeof message.budgetBytes === 'number' &&
          typeof message.usedBytes === 'number' && Number.isSafeInteger(message.budgetBytes) &&
          Number.isSafeInteger(message.usedBytes) && message.usedBytes >= 0 && message.budgetBytes > message.usedBytes) {
        budget = { contextId, budgetBytes: message.budgetBytes, usedBytes: message.usedBytes };
        clearTimeout(deadline);
        deadline = setTimeout(stop, 5_000).unref();
        resolveBudget({ ...budget });
      } else if (message?.kind === 'started' && claimed && !acknowledged) {
        acknowledged = true;
        resolveStarted(true);
      } else if (message?.kind === 'result' && acknowledged && !result && verifiedGpuReadback(message.value)) {
        result = message.value;
      } else { stop(); return; }
    }
  });
  return {
    processId: child.pid,
    budget: ready,
    started,
    closed: ended.then(() => {}),
    async run(lease: ResourceLease, signal: AbortSignal): Promise<WindowsGpuReadback> {
      const receipt = lease.receipt;
      if (!lease.active || claimed || child.killed || child.exitCode !== null || !budget || receipt.kind !== 'gpu' ||
          receipt.gpuContextId !== contextId || receipt.reservedVramBytes !== gpuReadbackReservationBytes ||
          receipt.reservedRamBytes < gpuReadbackRamReservationBytes ||
          Date.parse(receipt.expiresAt) <= Date.now()) throw Error('windows_gpu_lease_required');
      claimed = true;
      clearTimeout(deadline);
      const abort = AbortSignal.any([signal, lease.checkpointRequested]);
      abort.addEventListener('abort', stop, { once: true });
      try {
        if (abort.aborted) stop();
        else child.stdin.write('run\n');
        const code = await ended;
        abort.throwIfAborted();
        if (code !== 0 || !result) throw Error('windows_gpu_readback_failed');
        return result;
      } finally { abort.removeEventListener('abort', stop); }
    },
    async close() { stop(); await ended; },
  };
}
