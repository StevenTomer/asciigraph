import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs so the build works from any folder (e.g. example.com/graph/). Routing is
  // hash-based, so the server never sees app routes.
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
