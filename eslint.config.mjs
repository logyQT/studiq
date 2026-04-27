import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import hooksPlugin from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': hooksPlugin,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...hooksPlugin.configs.recommended.rules,

      // TS replaces base rules
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn'],

      'no-undef': 'off',

      // sensible defaults
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    ignores: ['node_modules', '.next', 'out', 'dist', 'build'],
  },

  prettierConfig,
];
