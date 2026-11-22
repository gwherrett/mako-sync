/**
 * Builds the Mako Clean add-on's actions_add.js. Run through `npm run mm:package`,
 * which then zips the add-on into mediamonkey/dist/mako-clean.mmip.
 *
 * One entry, built as an IIFE: MediaMonkey appends actions_add.js to its own
 * actions.js as a plain script, so the output can't use import/export.
 */
import { defineConfig } from 'vite';
import path from 'path';

const addonDir = import.meta.dirname;

export default defineConfig({
  root: addonDir,
  publicDir: false,
  resolve: {
    alias: {
      '@': path.resolve(addonDir, '../../src'),
    },
  },
  build: {
    outDir: path.resolve(addonDir, 'dist'),
    emptyOutDir: true,
    minify: false,
    // MediaMonkey 2024 runs on Chromium; keep the output conservative
    target: 'es2019',
    lib: {
      entry: path.resolve(addonDir, 'src/actions_add.ts'),
      formats: ['iife'],
      name: 'MakoClean',
      fileName: () => 'actions_add.js',
    },
  },
});
