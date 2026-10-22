import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['contract/src/test/**/*.test.ts'], testTimeout: 30000, reporters: ['verbose'] },
});
