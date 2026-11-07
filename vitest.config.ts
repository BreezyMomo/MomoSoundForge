import { defineConfig, configDefaults } from 'vitest/config';

// Test suites are explicit. Missing resource packs fail asset/provenance suites;
// they never silently turn tests into skips.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/**/*.test.{ts,mjs}'], exclude: [...configDefaults.exclude, '**/*.assets.test.*', '**/*.provenance.test.*'] } },
      { test: { name: 'assets', include: ['tests/**/*.assets.test.{ts,mjs}'] } },
      { test: { name: 'provenance', include: ['tests/**/*.provenance.test.{ts,mjs}'] } },
    ],
  },
});
