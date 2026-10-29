import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import standard from "./playwright.config";

/** Explicit external-source benchmark; separate from deterministic provider fixtures. */
export default defineConfig({
  ...standard,
  testMatch: "merlin.benchmark.ts",
  webServer: {
    command: "E2E_AI_UNCONFIGURED=1 bun scripts/e2e-server.ts",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: "http://127.0.0.1:8797/api/games",
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
