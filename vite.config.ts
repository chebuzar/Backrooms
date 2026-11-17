import { defineConfig } from 'vitest/config';

// BASE_PATH задаёт GitHub Actions ('/<repo>/'); локально — './'.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  resolve: {
    // Один вход в three: аддоны (GLTFLoader и т. п.) импортируют 'three' — направляем их в WebGPU-сборку,
    // чтобы в игре не было второй копии рендерера.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }]
  },
  build: {
    target: ['es2023', 'safari18', 'chrome120', 'firefox128'],
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'recast', test: /node_modules[\\/](@recast-navigation|recast-navigation)/ }
          ]
        }
      }
    }
  },
  server: { host: true },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' }
});
