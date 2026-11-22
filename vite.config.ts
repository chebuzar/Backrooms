import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

// Версія збірки — у кожен відгук гравця (src/build-info.ts). GitHub Actions дає GITHUB_SHA,
// тестовий сайт (scripts/preview-site/build.mjs) — BUILD_COMMIT, локально — git.
function commit(): string {
  const env = process.env.BUILD_COMMIT || process.env.GITHUB_SHA;
  if (env) return env.trim().slice(0, 40);
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

// BASE_PATH задаёт GitHub Actions ('/<repo>/'); локально — './'.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  define: { __BUILD__: JSON.stringify({ commit: commit(), date: new Date().toISOString() }) },
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
        codeSplitting: {
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
