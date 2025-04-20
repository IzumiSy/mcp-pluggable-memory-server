import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    workspace: [
      {
        test: {
          name: "unit-tests",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e-tests",
          environment: "node",
          include: ["e2e-tests/**/*.test.ts"],
        },
      },
    ],
  },
});
