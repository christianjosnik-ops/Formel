import { defineConfig } from 'vitest/config';

// Relative base: funktioniert unter https://<user>.github.io/<repo>/ ebenso wie lokal.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
