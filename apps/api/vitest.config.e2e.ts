import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The files share one database and the pickup clock, so they run one after another.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    // The pickup-rules test runs 31 simulated hours of every rule.
    testTimeout: 30_000,
  },
});
