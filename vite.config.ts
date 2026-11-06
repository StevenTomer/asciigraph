import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Every file under a folder, as paths relative to it. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]
  );

/**
 * Offline: writes sw.js (from src/pwa/sw.js) listing every file of the build to cache, with a
 * version that changes whenever any of them does.
 */
function serviceWorker(): Plugin {
  return {
    name: "asciigraph-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const pub = filesIn("public");
      const files = [...new Set([...built, ...pub])].sort();
      const hash = createHash("sha256");
      for (const f of built) {
        const out = bundle[f];
        hash.update(f).update(out.type === "chunk" ? out.code : typeof out.source === "string" ? out.source : Buffer.from(out.source));
      }
      for (const f of pub) hash.update(f).update(readFileSync(join("public", f)));
      const source = readFileSync("src/pwa/sw.js", "utf8")
        .replace("__FILES__", JSON.stringify(files))
        .replace("__VERSION__", JSON.stringify(hash.digest("hex").slice(0, 12)));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build works from any folder (e.g. example.com/graph/). Routing is
  // hash-based, so the server never sees app routes.
  base: "./",
  plugins: [react(), serviceWorker()],
  build: { outDir: "dist", sourcemap: true },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
