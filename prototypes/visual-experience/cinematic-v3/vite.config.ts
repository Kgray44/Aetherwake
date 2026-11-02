import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
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
