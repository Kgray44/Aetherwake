import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: ".runtime/dist-memory-inspector",
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./memory-inspector.html", import.meta.url)),
      output: { entryFileNames: "memory-inspector.js", inlineDynamicImports: true },
    },
  },
});
