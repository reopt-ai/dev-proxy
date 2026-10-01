import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__test-utils__/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/__test-utils__/**",
        "src/index.tsx",
        "src/bootstrap.ts",
        "src/commands/**/*.tsx",
        // peer.ts is a command too (plain console output); its arg parser is
        // unit-tested, the network/spawn paths are exercised manually.
        "src/commands/peer.ts",
        "src/cli/output.tsx",
        "src/cli/net.ts",
        "src/hooks/**",
        "src/components/**",
        "src/proxy/types.ts",
        "src/types.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 86,
        statements: 90,
      },
    },
  },
});
