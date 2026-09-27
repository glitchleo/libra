import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/src/**/*.test.ts', 'client/src/**/*.test.tsx', 'shared/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
