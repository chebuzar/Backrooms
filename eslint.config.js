import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'public/libs/**', 'node_modules/**', 'server/node_modules/**', '.shots/**', 'scripts/libs-check/**', 'scripts/asset-view/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  // скрипти Node; код у page.evaluate(...) виконується в браузері, тому й браузерні глобали
  { files: ['scripts/**', 'tests/e2e/**', 'server/**', '*.config.*'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.js', '**/*.mjs'], rules: { '@typescript-eslint/no-unused-vars': ['warn', { caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] } }
);
