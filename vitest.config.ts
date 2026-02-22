import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/services/**/*.ts', 'src/utils/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.mock.ts',
        'src/integrations/**',
        // Browser-only debug utilities (require DOM/localStorage/navigator)
        'src/utils/debugHelpers.ts',
        'src/utils/reloadDebugger.ts',
        'src/utils/serviceWorkerCleanup.ts',
        'src/utils/storageIsolationTest.ts',
        // Mock service (not production code)
        'src/services/spotifyAuthManager.mock.service.ts',
        // Type-only files
        'src/services/__tests__/fixtures/eval-types.ts',
      ],
      thresholds: {
        statements: 55,
        branches: 55,
        functions: 55,
        lines: 55,
      },
    },
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
