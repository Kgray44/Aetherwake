import { defineConfig } from "vite";
import { reviewRendererReceipt } from "../../../scripts/review-renderer.mjs";
import { liveMediaPreload, wakeCapturePreload, wakeHostCore } from './native/live-media-build.mjs';
import {windowsSystemNative} from './native/windows-system-build.mjs';

export default defineConfig({
  base: "./",
  plugins: [liveMediaPreload(), wakeCapturePreload(), wakeHostCore(), windowsSystemNative(), reviewRendererReceipt()],
  resolve: { dedupe: ["three"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          graphics: ["three", "three/addons/environments/RoomEnvironment.js"],
        },
      },
    },
  },
});
