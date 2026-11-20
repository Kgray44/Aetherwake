import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()],
  base:'/',
  build:{ outDir:'dist', emptyOutDir:true },
  worker:{
    rollupOptions:{ output:{
      // A Task tab can stay open across deployments before starting its first export.
      entryFileNames:({name}) => name === 'task-report.worker' ? 'assets/[name].js' : 'assets/[name]-[hash].js',
    } },
  },
  server:{ host:'127.0.0.1',port:5178,strictPort:true,proxy:{ '/api':'http://127.0.0.1:4178' } },
});
