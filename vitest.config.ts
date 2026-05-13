import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode || 'test', process.cwd(), '');
  return {
    define: {
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL || ''),
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''),
    },
    test: {
      globals: true,
      environment: 'node',
      setupFiles: ['./__tests__/setup.ts'],
      include: ['src/**/*.test.ts', '__tests__/integration/**/*.test.ts'],
      exclude: ['node_modules', 'dist', '.next'],
      coverage: {
        provider: 'v8',
        include: ['src/server/**/*.ts'],
        exclude: ['src/server/**/*.test.ts', 'src/server/**/index.ts'],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
