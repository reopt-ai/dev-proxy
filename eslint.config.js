import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // ── Ignore patterns ────────────────────────────────────────
  {
    ignores: [
      "dist/",
      "node_modules/",
      "bin/",
      "coverage/",
      "worktrunk/",
      "eslint.config.js",
      "vitest.config.ts",
    ],
  },

  // ── Base ───────────────────────────────────────────────────
  eslint.configs.recommended,

  // ── TypeScript strict + stylistic ──────────────────────────
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── React Hooks ────────────────────────────────────────────
  {
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // ── Project rules ──────────────────────────────────────────
  {
    rules: {
      // Strictness
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",

      // Safety
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-debugger": "error",
      eqeqeq: ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "error",
      "prefer-const": "error",
      "no-var": "error",

      // Relaxations for Ink/React TUI patterns
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  // ── Test file overrides ────────────────────────────────────
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "no-console": "off",
    },
  },

  // ── CLI tool overrides (commands + cli.ts use console for user output) ──
  {
    files: ["src/cli.ts", "src/commands/*.tsx"],
    rules: {
      "no-console": "off",
    },
  },

  // ── Prettier (must be last) ────────────────────────────────
  prettier,
);
