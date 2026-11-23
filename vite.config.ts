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

/** The commit being built (from .git, without needing git itself), or null. */
function commit(): string | null {
  try {
    const head = readFileSync(".git/HEAD", "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 7);
    const ref = head.slice(5);
    try {
      return readFileSync(join(".git", ref), "utf8").trim().slice(0, 7);
    } catch {
      const line = readFileSync(".git/packed-refs", "utf8").split("\n").find((l) => l.endsWith(" " + ref));
      return line ? line.slice(0, 7) : null;
    }
  } catch {
    return null;
  }
}

/** Shown in help: "0.1.0 (e182174, built 2026-11-23)". */
const version = (() => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")).version as string;
  const built = new Date().toISOString().slice(0, 10);
  const c = process.env.ASCIIGRAPH_COMMIT || commit();
  return `${pkg} (${c ? c + ", " : ""}built ${built})`;
})();

/** The live-editing server (server/), for `npm run dev` and `vite preview`: api/ and ws are
 * passed to it, as nginx does in Docker. */
const collab = process.env.ASCIIGRAPH_COLLAB ?? "http://127.0.0.1:1234";
const proxy = {
  "/api": { target: collab, changeOrigin: true },
  "/ws": { target: collab.replace(/^http/, "ws"), ws: true },
};

export default defineConfig({
  // Relative asset URLs so the build works from any folder (e.g. example.com/graph/). Routing is
  // hash-based, so the server never sees app routes.
  base: "./",
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "dist", sourcemap: true },
  server: { proxy },
  preview: { proxy },
  test: { include: ["src/**/*.test.ts", "server/**/*.test.ts"], environment: "node" },
});
