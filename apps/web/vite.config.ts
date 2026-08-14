import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "digipology-canonical-json": fileURLToPath(
        new URL("../../packages/canonical-json/src/index.ts", import.meta.url),
      ),
      "digipology-kernel": fileURLToPath(
        new URL("../../packages/kernel/src/index.ts", import.meta.url),
      ),
      "digipology-prng": fileURLToPath(
        new URL("../../packages/prng/src/index.ts", import.meta.url),
      ),
      "digipology-protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url),
      ),
    },
  },
});
