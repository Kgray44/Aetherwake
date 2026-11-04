import { defineConfig } from "vite";
import { reviewRendererReceipt } from "../../../scripts/review-renderer.mjs";
import { liveMediaPreload } from './native/live-media-build.mjs';

export default defineConfig({
  base: "./",
  plugins: [liveMediaPreload(), reviewRendererReceipt()],
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
