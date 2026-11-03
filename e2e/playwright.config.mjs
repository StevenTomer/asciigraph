import { defineConfig, devices } from "@playwright/test";

const port = process.env.TEST_SERVER_PORT || "4174";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  reporter: "list",
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1200, height: 800 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 800 } } }],
});
