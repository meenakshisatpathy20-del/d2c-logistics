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
    // Older tests book prepaid orders without a payment; the payment guard test turns it on for itself.
    env: { PAYMENT_GUARD: 'off' },
    // The pickup-rules test runs 31 simulated hours of every rule.
    testTimeout: 30_000,
  },
});
