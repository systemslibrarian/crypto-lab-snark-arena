/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/crypto-lab-snark-arena/',
  test: {
    // Crypto-core unit tests live next to the source under src/.
    // The Playwright a11y suite in e2e/ is driven separately by `test:a11y`
    // and must never be collected by vitest.
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
