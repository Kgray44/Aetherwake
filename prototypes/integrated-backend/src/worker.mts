import { parentPort, workerData } from 'node:worker_threads';
import { BackendCore } from './core.mts';
import { CONTRACT, type Options } from './contracts.mts';
import {createNativeHostClient,isNativeHostEnvelope} from './native-host.mts';
import {createNativeLiveHostClient,isNativeLiveHostEnvelope} from './live-media-host.mts';
const port = parentPort!;
const hosted=workerData?.nativeHostProtocol===1;
const nativeClient=hosted?createNativeHostClient(message=>port.postMessage(message)):undefined;
const liveClient=hosted&&workerData.nativeLiveHostProtocol===1?createNativeLiveHostClient(message=>port.postMessage(message)):undefined;
port.on('close',()=>nativeClient?.close());
try {
  const options=(hosted?workerData.options:workerData) as Options;
  const core = new BackendCore(options, event => port.postMessage({ event }),nativeClient?{...nativeClient.services,...(liveClient?{liveMedia:liveClient.services}:{})}:undefined);
  port.on('message', async request => {
    if(isNativeLiveHostEnvelope(request)){liveClient?.handle(request);return;}
    if(isNativeHostEnvelope(request)){nativeClient?.handle(request);return;}
    if (request && Object.hasOwn(request, 'missionHostSignal')) {
      if (hosted && Object.keys(request).length === 1)
        await core.command('missionHostSignal', request.missionHostSignal).catch(() => {});
      return;
    }
    const { id, contract, command, input } = request;
    try {
      if (contract !== CONTRACT) throw Object.assign(new Error(), { code: 'unsupported_contract' });
      const result = await core.command(command, input);
      port.postMessage({ id, result });
      if (command === 'close') { liveClient?.close();nativeClient?.close();port.close(); }
    } catch (e) {
      // Raw native diagnostics may contain personal paths/content. Send codes only.
      const candidate = (e as any).code ?? (e as any).kind;
      const code = typeof candidate === 'string' && /^[a-zA-Z_\-]{1,80}$/.test(candidate) ? candidate : 'operation_failed';
      port.postMessage({ id, error: code });
    }
  });
  port.postMessage({ ready: true });
} catch { liveClient?.close();nativeClient?.close(); port.postMessage({ startupError: 'storage_or_schema_failure' }); port.close(); }
