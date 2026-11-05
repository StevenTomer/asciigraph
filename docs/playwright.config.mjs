// Regenerates the screenshots in docs/images: npm run screenshots
import { defineConfig, devices } from "@playwright/test";

const port = process.env.TEST_SERVER_PORT || "4174";

export default defineConfig({
  testDir: ".",
  testMatch: "screenshots.spec.js",
  reporter: "list",
  workers: 1,
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: true,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  },
});
