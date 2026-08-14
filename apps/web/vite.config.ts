import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@babylonjs/core/") || id.includes("\\node_modules\\@babylonjs\\core\\")) {
            return "babylon-vendor";
          }
        },
      },
    },
  },
  optimizeDeps: {
    // Emscripten's .wasm URL is resolved by stylua-wasm itself. Vite/esbuild
    // pre-bundling rewrites that URL and can leave initialization waiting forever.
    include: ["wasmoon"],
    exclude: ["stylua-wasm"],
  },
  resolve: {
    alias: {
      "digipology-canonical-json": fileURLToPath(
        new URL("../../packages/canonical-json/src/index.ts", import.meta.url),
      ),
      "digipology-kernel": fileURLToPath(
        new URL("../../packages/kernel/src/index.ts", import.meta.url),
      ),
      "digipology-lua/lua-api-manifest": fileURLToPath(
        new URL("../../packages/lua/src/luaApiManifest.ts", import.meta.url),
      ),
      "digipology-lua": fileURLToPath(
        new URL("../../packages/lua/src/index.ts", import.meta.url),
      ),
      "digipology-prng": fileURLToPath(
        new URL("../../packages/prng/src/index.ts", import.meta.url),
      ),
      "digipology-protocol/http": fileURLToPath(
        new URL("../../packages/protocol/src/http.ts", import.meta.url),
      ),
      "digipology-protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url),
      ),
    },
  },
});
