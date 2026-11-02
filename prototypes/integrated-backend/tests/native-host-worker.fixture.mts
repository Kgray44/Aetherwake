import { parentPort } from "node:worker_threads";
import {
  createNativeHostClient,
  isNativeHostEnvelope,
} from "../src/native-host.mts";
const port = parentPort!;
const client = createNativeHostClient((message) => port.postMessage(message), {
  timeoutMs: 1000,
});
port.on("close", () => client.close());
port.on("message", async (value) => {
  if (isNativeHostEnvelope(value)) {
    client.handle(value);
    return;
  }
  if (value?.fixture === "exercise") {
    try {
      const available = await client.services.secrets.available(),
        cipher = await client.services.secrets.seal(
          "SYNTHETIC_PRIVATE_HOP_MARKER",
        ),
        plain = await client.services.secrets.open(cipher);
      port.postMessage({
        fixtureResult: {
          available,
          matches: plain === "SYNTHETIC_PRIVATE_HOP_MARKER",
          bytes: cipher.length,
        },
      });
    } catch {
      port.postMessage({ fixtureResult: { failed: true } });
    }
  } else if (value?.fixture === "close") {
    client.close();
    port.close();
  }
});
