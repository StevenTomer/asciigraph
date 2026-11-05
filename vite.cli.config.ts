import { defineConfig } from "vite";

/** The command line (src/cli): one self-contained Node script, cli/asciigraph.mjs. */
export default defineConfig({
  build: {
    ssr: "src/cli/main.ts",
    outDir: "cli",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: { output: { entryFileNames: "asciigraph.mjs", banner: "#!/usr/bin/env node" } },
  },
  ssr: { noExternal: true },
  publicDir: false,
});
