import type { NativeHostServices } from "../src/native-host.mts";
export class BackendCore {
  private native: NativeHostServices | undefined;
  private emit: (value: unknown) => void;
  private attempts = 0;
  private failFirst: boolean;
  constructor(
    options: { path: string },
    emit: (value: unknown) => void,
    native?: NativeHostServices,
  ) {
    this.native = native;
    this.emit = emit;
    this.failFirst = options.path.endsWith("fail-first.sqlite");
  }
  async command(name: string) {
    if (name === "snapshot")
      return {
        available: this.native ? await this.native.secrets.available() : false,
        attempts: this.attempts,
      };
    if (name === "close") {
      this.attempts++;
      if (this.failFirst && this.attempts === 1)
        throw Object.assign(new Error("synthetic failed graceful close"), {
          code: "fixture_close_denied",
        });
      if (this.native) {
        if ((await this.native.secrets.available()) !== true)
          throw Object.assign(new Error(), {
            code: "fixture_native_unavailable",
          });
        const cipher = await this.native.secrets.seal(
          "SYNTHETIC_PRIVATE_CLOSE_MARKER",
        );
        if (
          (await this.native.secrets.open(cipher)) !==
          "SYNTHETIC_PRIVATE_CLOSE_MARKER"
        )
          throw Object.assign(new Error(), { code: "fixture_crypto_failed" });
      }
      this.emit({
        type: "fixture/closed",
        classification: "simulated",
        payload: { attempts: this.attempts },
      });
      return null;
    }
    throw Object.assign(new Error(), { code: "fixture_unsupported" });
  }
}
