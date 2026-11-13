import { defineConfig, devices } from '@playwright/test'

// E2E runs against ISOLATED servers (API :8078 with a throwaway SQLite DB, Vite :5189),
// so it never touches the development database.
const DB = `/tmp/fiberscope-e2e-${process.pid}.db`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5189', trace: 'retain-on-failure', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `rm -f ${DB}* && cd ../backend && FIBERSCOPE_DATABASE_URL=sqlite:///${DB} uv run uvicorn app.main:app --host 127.0.0.1 --port 8078`,
      url: 'http://127.0.0.1:8078/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'FIBERSCOPE_API_URL=http://127.0.0.1:8078 npx vite --port 5189 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5189',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
