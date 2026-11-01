import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: '../../../assets/brand',
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2021' },
});
