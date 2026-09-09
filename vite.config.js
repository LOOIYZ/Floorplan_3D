import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any sub-path (GitHub/GitLab Pages).
  base: './',
  server: {
    host: true,
    open: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
