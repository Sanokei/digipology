import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Explicit native Lite check; a WebGL fallback cannot satisfy its assertion. */
export default defineConfig({
  ...base, testMatch: "cardDesigns.e2e.ts",
  projects: [{ name: "native-card", use: { ...base.use, launchOptions: {
    ...base.use?.launchOptions,
    args: ["--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan", "--use-vulkan=swiftshader"],
  } } }],
});
