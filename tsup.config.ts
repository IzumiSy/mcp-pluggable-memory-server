/// <reference types="node" />
import { defineConfig } from "tsup";

export default defineConfig({
  format: "esm",
  outExtension: () => ({
    js: ".mjs",
  }),
});
