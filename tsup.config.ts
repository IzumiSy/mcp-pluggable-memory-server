/// <reference types="node" />
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/client/index.ts",
    "src/db-server/index.ts",
    "src/launcher/index.ts",
  ],
  format: "esm",
  outExtension: () => ({
    js: ".mjs",
  }),
  clean: true,
});
