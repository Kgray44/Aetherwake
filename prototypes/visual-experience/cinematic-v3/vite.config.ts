import { defineConfig } from "vite";
import { reviewRendererReceipt } from "../../../scripts/review-renderer.mjs";

export default defineConfig({
  base: "./",
  plugins: [reviewRendererReceipt()],
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
