import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode || "test", process.cwd(), "");
  return {
    define: {
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL || ""),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""),
      "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify(env.NEXT_PUBLIC_SITE_URL || ""),
      "process.env.SUPABASE_SERVICE_ROLE_KEY": JSON.stringify(env.SUPABASE_SERVICE_ROLE_KEY || ""),
    },
    test: {
      env: {
        OTEL_SDK_DISABLED: "true",
      },
      globals: true,
      environment: "node",
      setupFiles: ["./__tests__/setup.ts"],
      include: ["__tests__/unit/**/*.test.ts", "__tests__/integration/**/*.test.ts"],
      exclude: ["node_modules", "dist", ".next"],
      // ── Concurrency ──────────────────────────────────────────
      // fileParallelism: files run in parallel across workers (one worker per file).
      // sequence.concurrent: OFF — integration tests share a module-scoped mock
      //   (vi.mock('@/lib/supabase/server')), and Vitest's concurrent tests within
      //   a file share the same mock function instance.  Concurrent tests would race
      //   on mockImplementation(), causing non-deterministic failures.  Keeping this
      //   OFF ensures mock isolation within each file.
      //
      // 3× side-by-side mechanism: each `it()` is registered 3 times via the
      //   `forEachCopy()` helper (__tests__/helpers/concurrent.ts).  Within a file,
      //   the 3 copies run sequentially (safe for shared mocks).  Across files,
      //   fileParallelism runs them concurrently — so copies from DIFFERENT files
      //   interleave, proving cross-file isolation in a single pass.
      //
      // Effective concurrency: 19 files × 3 copies ≈ 57 tasks.  With fileParallelism,
      //   up to `cpus` files run simultaneously.  Each file's 3 copies run sequentially,
      //   but copies from OTHER files interleave between tests.
      fileParallelism: true,
      sequence: {
        concurrent: false,
      },
      coverage: {
        provider: "v8",
        include: ["src/server/**/*.ts"],
        exclude: ["src/server/**/index.ts", "src/server/**/routes.config.ts"],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "#test": path.resolve(__dirname, "./__tests__"),
      },
    },
  };
});
