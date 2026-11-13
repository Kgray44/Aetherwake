import { parentPort, workerData } from 'node:worker_threads';
import { BackendCore } from './core.mts';
import { CONTRACT, type Options } from './contracts.mts';
import {createNativeHostClient,isNativeHostEnvelope} from './native-host.mts';
import {createNativeLiveHostClient,isNativeLiveHostEnvelope} from './live-media-host.mts';
import {createSystemFactsClient,isSystemFactsEnvelope} from './system-facts-host.mts';
import {createDocumentTextClient,isDocumentTextEnvelope} from './document-text-host.mts';
import {createNativeWakeCaptureClient,isNativeWakeCaptureMessage} from './wake-capture-host.mts';
import {createWindowsMaintenanceClient,isWindowsMaintenanceEnvelope} from './windows-maintenance-host.mts';
import {createWindowsComputerClient,isWindowsComputerEnvelope} from './windows-computer-host.mts';
const port = parentPort!;
const fixture = workerData?.memoryFixture;
const hosted=!fixture && workerData?.nativeHostProtocol===1;
const nativeClient=hosted || fixture ? createNativeHostClient(message=>port.postMessage(message)):undefined;
const liveClient=hosted&&workerData.nativeLiveHostProtocol===1?createNativeLiveHostClient(message=>port.postMessage(message)):undefined;
const systemClient=hosted&&workerData.nativeSystemFactsProtocol===1?createSystemFactsClient(message=>port.postMessage(message)):undefined;
const documentClient=hosted&&workerData.nativeDocumentTextProtocol===1?createDocumentTextClient(message=>port.postMessage(message)):undefined;
const wakeClient=hosted&&workerData.nativeWakeCaptureProtocol===1?createNativeWakeCaptureClient(message=>port.postMessage(message)):undefined;
const maintenanceClient=hosted&&workerData.nativeMaintenanceHostProtocol===1?createWindowsMaintenanceClient(message=>port.postMessage(message)):undefined;
const computerClient=hosted&&workerData.nativeComputerHostProtocol===1?createWindowsComputerClient(message=>port.postMessage(message)):undefined;
port.on('close',()=>{maintenanceClient?.close();computerClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();nativeClient?.close();});
try {
  if (fixture && Object.keys(workerData).some(key => !['memoryFixture', 'options'].includes(key))) throw Error('memory_fixture_bootstrap_invalid');
  const options=(hosted || fixture ? workerData.options : workerData) as Options;
  if (fixture?.contract === 'aerynth.memory-fixture-restart@1') {
    // Recheck the parent's bound DB identity before Core opens the file for writes.
    const custodyReply = (request: unknown) => {
      if (isNativeHostEnvelope(request)) nativeClient!.handle(request);
    };
    port.on('message', custodyReply);
    try {
      if (!await nativeClient!.services.secrets.available()) throw Error('memory_fixture_restart_failed');
    } finally { port.off('message', custodyReply); }
  }
  const core = new BackendCore(options, event => port.postMessage({ event }),hosted && nativeClient?{...nativeClient.services,resourcePolicy:workerData.resourcePolicy,...(liveClient?{liveMedia:liveClient.services}:{}),...(systemClient?{systemFacts:systemClient.services}:{}),...(wakeClient?{wakeCapture:wakeClient.services}:{}),...(documentClient?{documents:documentClient.services}:{}),...(maintenanceClient?{maintenance:maintenanceClient.services}:{}),...(computerClient?{computer:computerClient.services}:{})}:undefined,
    undefined, undefined, fixture ? { descriptor: fixture, protector: nativeClient!.services.secrets } : undefined);
  port.on('message', async request => {
    if(isWindowsMaintenanceEnvelope(request)){maintenanceClient?.handle(request);return;}
    if(isWindowsComputerEnvelope(request)){computerClient?.handle(request);return;}
    if(isNativeWakeCaptureMessage(request)){wakeClient?.handle(request);return;}
    if(isSystemFactsEnvelope(request)){systemClient?.handle(request);return;}
    if(isDocumentTextEnvelope(request)){documentClient?.handle(request);return;}
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
      const result = await core.command(command, input, !!fixture && request.fixturePolicyReviewed === true,
        !!fixture && request.fixtureDetailReviewed === true);
      port.postMessage({ id, result });
      if (command === 'close') { maintenanceClient?.close();computerClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();liveClient?.close();nativeClient?.close();port.close(); }
    } catch (e) {
      // Raw native diagnostics may contain personal paths/content. Send codes only.
      const candidate = (e as any).code ?? (e as any).kind;
      const code = typeof candidate === 'string' && /^[a-zA-Z_\-]{1,80}$/.test(candidate) ? candidate : 'operation_failed';
      port.postMessage({ id, error: code });
    }
  });
  port.postMessage({ ready: true });
} catch { maintenanceClient?.close();computerClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();liveClient?.close();nativeClient?.close(); port.postMessage({ startupError: 'storage_or_schema_failure' }); port.close(); }
