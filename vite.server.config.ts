import { defineConfig } from "vite";

/** The live-editing server (server/): one self-contained Node script, server-dist/server.mjs. */
export default defineConfig({
  build: {
    ssr: "server/main.ts",
    outDir: "server-dist",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: { output: { entryFileNames: "server.mjs" } },
  },
  ssr: { noExternal: true },
  publicDir: false,
});
