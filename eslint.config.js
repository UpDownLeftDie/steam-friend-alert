import narwhal from 'eslint-config-narwhal';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['worker-configuration.d.ts', 'dist/**', '.wrangler/**', '.mf/**'],
  },
  ...narwhal,
  ...tseslint.configs.recommended,
);
