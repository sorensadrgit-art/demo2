import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:8011' },
  webServer: { command: 'npm run dev', port: 8011, reuseExistingServer: true },
});
