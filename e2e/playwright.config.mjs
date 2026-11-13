import { defineConfig, devices } from "@playwright/test";

const port = process.env.TEST_SERVER_PORT || "4174";
// The live-editing server, with its diagrams in memory (gone when the tests end).
const collabPort = process.env.TEST_COLLAB_PORT || "4175";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  reporter: "list",
  webServer: [
    {
      command: `node server-dist/server.mjs`,
      cwd: "..",
      env: { PORT: collabPort, ASCIIGRAPH_DB: ":memory:" },
      url: `http://127.0.0.1:${collabPort}/api/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
      cwd: "..",
      env: { ASCIIGRAPH_COLLAB: `http://127.0.0.1:${collabPort}` },
      url: `http://127.0.0.1:${port}/`,
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1200, height: 800 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 800 } } }],
});
