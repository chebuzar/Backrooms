import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  globalIgnores(['dist/**', '.vite/**', 'public/libs/**', 'node_modules/**', 'server/node_modules/**', '.shots/**', 'scripts/libs-check/**', 'scripts/asset-view/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
      // типи для правил нижче: тихо «загублені» проміси й застарілі (@deprecated) API ловить лінтер, а не гравець
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  // скрипти Node; код у page.evaluate(...) виконується в браузері, тому й браузерні глобали
  { files: ['scripts/**', 'tests/e2e/**', 'server/**', '*.config.*'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.js', '**/*.mjs'], rules: { '@typescript-eslint/no-unused-vars': ['warn', { caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] } }
);
