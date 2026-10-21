import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noSilentEmptyResult from "./eslint-rules/no-silent-empty-result.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    // Gitignored scratch/research + promo-video build (not tracked source —
    // keep eslint aligned with gitignore so CI lint == tracked surface).
    "videos/**",
    "local/**",
    // Untracked scratch scripts (tmp-*.ts). They are working files, never
    // committed — linting them would put noise into CI that no commit owns.
    "src/**/tmp-*.ts",
    "scripts/tmp-*.ts",
  ]),
  {
    plugins: {
      // Local rules for failure shapes this repo has been bitten by.
      integrity: { rules: { 'no-silent-empty-result': noSilentEmptyResult } },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // A catch that returns an empty result without logging, rethrowing, or
      // pushing to an errors array makes an upstream failure invisible to the
      // caller. This repo shipped a scanner that dropped 8 of 10 tokens per
      // pass because a rate-limited request returned [].
      'integrity/no-silent-empty-result': 'error',
    },
  },
]);

export default eslintConfig;
