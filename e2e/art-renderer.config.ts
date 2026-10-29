import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Explicit second renderer check; a requested Lite fallback cannot pass it. */
export default defineConfig({
  ...base,
  testMatch: "rasterArt.e2e.ts",
  projects: [{ name: "native-art", use: {
    ...base.use,
    launchOptions: {
      ...base.use?.launchOptions,
      args: ["--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan", "--use-vulkan=swiftshader"],
    },
  } }],
});
