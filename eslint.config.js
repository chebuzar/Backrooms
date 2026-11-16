import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '.shots/**', 'node_modules/**', 'src/render/n8ao/**', 'server/node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  { files: ['scripts/**', 'server/**', '*.config.js'], ignores: ['scripts/libs-check/**'], languageOptions: { globals: { ...globals.node } } }
];
