/// <reference types="node" />
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/db-server/index.ts", "src/launcher.ts"],
  format: "esm",
  outExtension: () => ({
    js: ".mjs",
  }),
  clean: true,
});
