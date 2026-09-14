import tseslint from "typescript-eslint";

/**
 * ESLint 9 flat config (tasks 1.4, 1.5).
 *
 * `strict: true` in tsconfig already catches type errors; this config catches the things the
 * compiler deliberately permits, notably unused bindings. Type-aware parsing is switched off on
 * purpose: `parserOptions.project` roughly triples lint time and the rules it unlocks are not the
 * ones this repository needs, because the risk profile here is "dead or accidental code", not
 * "subtly wrong types".
 *
 * `dist/` is ignored explicitly. Flat config does not read `.gitignore`, so without this a built
 * artefact would be linted and its `//# sourceMappingURL` comment would look like a violation.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".scratch/**", "coverage/**", "*.zip"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `console` is the only diagnostic channel available inside an MV3 service worker that has
      // no DOM, so it is used deliberately rather than accidentally.
      "no-console": "off",
    },
  }
);
