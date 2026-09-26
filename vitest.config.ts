import { defineConfig } from 'vitest/config';

// Root suite covers the web app only; server/ and packages/* run their own.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.{ts,tsx}'],
  },
});
