import { defineConfig } from 'vitest/config';

// Served from the site root (https://lakes.bristleconelab.org). Set BASE=/some/path/ to host under a sub-path.
export default defineConfig({
  base: process.env.BASE ?? '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
