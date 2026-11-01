import { createInterface } from "node:readline";
import { Backend } from "./service.mts";
const [path, privateRoot, cwd] = process.argv.slice(2);
const backend = new Backend({
  path,
  privateRoot,
  cwd,
  contentPolicy: "local-private",
  provider: "codex",
  retention: { maxEvents: 10000 },
});
const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
backend.subscribe((event) => write({ event }));
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let id: unknown;
  try {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024 + 2048)
      throw new Error("command_too_large");
    const request = JSON.parse(line);
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
      ].includes(request.command)
    )
      throw new Error("unsupported_command");
    const result = await backend.call(request.command, request.input);
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
    void backend
      .close()
      .catch(() => {})
      .finally(() => process.exit()),
);
