import { defineConfig, devices } from '@playwright/test';

// End-to-end checks on the production build, in Chromium and WebKit (Safari's engine),
// at phone and desktop sizes. Run: npm run build && npx playwright test
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node e2e/serve.mjs', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium-pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
    { name: 'webkit-iphone-landscape', use: { ...devices['iPhone 13 landscape'] } },
  ],
});
