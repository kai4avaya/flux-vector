/**
 * Rollup config for building the worker script
 * This bundles the worker with all its dependencies into a single file
 */

import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
  input: 'workers/worker.ts',
  output: {
    file: 'dist/workers/worker.js',
    format: 'es', // ES modules for modern browsers
    sourcemap: true,
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false, // No .d.ts files for worker
      sourceMap: true,
      compilerOptions: {
        module: 'ESNext',
        target: 'ES2020',
      },
      tslib: resolve(__dirname, 'node_modules/tslib'),
    }),
    nodeResolve({
      browser: true, // Resolve browser versions of packages
      preferBuiltins: false,
    }),
    commonjs(), // Convert CommonJS to ES modules
  ],
  external: [], // Bundle everything (worker needs all deps)
  onwarn(warning, warn) {
    // Suppress warnings about circular dependencies in transformers.js
    if (warning.code === 'CIRCULAR_DEPENDENCY') {
      return;
    }
    // Suppress warnings about PURE annotations in pre-bundled transformers.js
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || 
        (warning.message && warning.message.includes('PURE'))) {
      return;
    }
    warn(warning);
  },
};
