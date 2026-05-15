import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode || 'test', process.cwd(), '');
  return {
    define: {
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL || ''),
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      ),
      'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify(env.NEXT_PUBLIC_SITE_URL || ''),
    },
    test: {
      globals: true,
      environment: 'node',
      setupFiles: ['./__tests__/setup.ts'],
      include: ['src/**/*.test.ts', '__tests__/integration/**/*.test.ts'],
      exclude: ['node_modules', 'dist', '.next'],
      sequence: {
        concurrent: false,
      },
      coverage: {
        provider: 'v8',
        include: ['src/server/**/*.ts'],
        exclude: [
          'src/server/**/*.test.ts',
          'src/server/**/index.ts',
          'src/server/**/routes.config.ts',
        ],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '#test': path.resolve(__dirname, './__tests__'),
      },
    },
  };
});
