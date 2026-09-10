import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Config base de ESLint compartida (flat config).
 * Cada app la extiende y agrega sus plugins (react, nestjs, etc).
 */
export default tseslint.config(
  { ignores: ['dist', 'build', 'coverage', 'node_modules', '.turbo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
