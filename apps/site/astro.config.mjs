import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://digipology.com",
  output: "static",
  trailingSlash: "always",
  compressHTML: true,
  build: {
    format: "directory",
  },
});
