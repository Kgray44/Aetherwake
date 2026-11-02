import { createInterface } from "node:readline";
import { Backend } from "./service.mts";
import {createNativeHostClient,isNativeHostEnvelope} from './native-host.mts';
const [path, privateRoot, cwd,...flags] = process.argv.slice(2);
const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
const nativeClient=flags.length===1&&flags[0]==='--native-secrets'?createNativeHostClient(write):undefined;
const backend = new Backend({
  path,
  privateRoot,
  cwd,
  contentPolicy: "local-private",
  provider: "codex",
  retention: { maxEvents: 10000 },
},nativeClient?.services);
let closeTask:Promise<void>|null=null;
const closeBackend=()=>{
  if(closeTask)return closeTask;
  const task=backend.close().then(()=>{nativeClient?.close();});closeTask=task;
  void task.catch(()=>{if(closeTask===task)closeTask=null;});
  return task;
};
backend.subscribe((event) => write({ event }));
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let id: unknown;
  try {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024 + 2048)
      throw new Error("command_too_large");
    const request = JSON.parse(line);
    if(isNativeHostEnvelope(request)){nativeClient?.handle(request);return;}
    id = request.id;
    if (request.command === "metrics") {
      write({ id, result: process.memoryUsage() });
      return;
    }
    if (
      ![
        "desktop",
        "snapshot",
        "addMessage",
        "execute",
        "interrupt",
        "capabilities",
        "replay",
        "close",
        "viewState",
        "branch",
        "conversation",
        "conversationActivity",
        "openResource",
        "providerConnection",
        "providerAuth",
        "ordinaryProviderStatus",
        "ordinaryProviderCheck",
        "conversationSendPreview",
        "authorizeConversationSend",
        "conversationSend",
        "vela",
        "library",
        "notes",
        "velaRequestPreview",
        "velaNativeReview",
        "authorizeVelaRequest",
        "authorizeVelaDelegation",
      ].includes(request.command)
    )
      throw new Error("unsupported_command");
    const result = request.command==='close'?(await closeBackend(),null):await backend.call(request.command, request.input);
    write({ id, result });
    if (request.command === "close") {
      lines.close();
      process.exitCode = 0;
    }
  } catch (e) {
    write({
      id,
      error: /^[a-zA-Z_-]{1,80}$/.test((e as any).code ?? (e as any).message)
        ? ((e as any).code ?? (e as any).message)
        : "operation_failed",
    });
  }
});
lines.on(
  "close",
  () =>
    {void closeBackend()
      .then(()=>process.exit())
      .catch(async()=>{nativeClient?.close();await backend.terminate().catch(()=>{});process.exit(1);});},
);
