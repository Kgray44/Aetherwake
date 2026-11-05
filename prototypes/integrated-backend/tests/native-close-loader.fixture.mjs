// Test process only: exercise the REAL worker/service/desktop lifecycle with a
// synthetic Core dependency. No production option, command or authority added.
import { registerHooks } from "node:module";
const actual = new URL("../src/core.mts", import.meta.url).href;
const fixture = new URL("./native-close-core.fixture.mts", import.meta.url)
  .href;
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    return result.url === actual ? { ...result, url: fixture } : result;
  },
});
