import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: './',
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../')
    },
    extensions: ['.js', '.ts', '.json']
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
    include: ['uuid', 'd3-random', 'dexie']
  },
  server: {
    port: 3000,
    open: true,
    fs: {
      strict: false,
      allow: ['..']
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    }
  }
});
