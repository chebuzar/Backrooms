import { defineConfig } from 'vite';

// BASE_PATH задаёт GitHub Actions: '/<repo>/' для chebuzar.github.io/<repo>.
// Для своего домена или локально — './'.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  build: {
    target: ['es2020', 'safari15', 'chrome100', 'firefox100', 'edge100'],
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/peerjs')) return 'peerjs';
        }
      }
    }
  },
  server: { host: true }
});
