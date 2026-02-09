// rollup.config.js
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

// Define names once to ensure consistency
const FILENAME = 'lightweight-charts-line-tools-circle';
const GLOBAL_VAR_NAME = 'LightweightChartsLineToolsCircle';

const GLOBALS = {
  'lightweight-charts': 'LightweightCharts',
  'lightweight-charts-line-tools-core': 'LightweightChartsLineToolsCore'
};

const EXTERNAL = [
  'lightweight-charts',
  'lightweight-charts-line-tools-core'
];

export default {
  input: 'src/index.ts',
  output: [
    // 1. ESM (Modern Bundlers like Vite/Webpack)
    {
      file: `dist/${FILENAME}.js`,
      format: 'es',
      sourcemap: true,
    },
    // 2. UMD Development (Browser <script> tag - Readable for debugging)
    {
      file: `dist/${FILENAME}.umd.js`,
      format: 'umd',
      name: GLOBAL_VAR_NAME,
      globals: GLOBALS,
      sourcemap: true,
      exports: 'named', // Explicit named exports
    },
    // 3. UMD Production (Browser <script> tag - Minified)
    {
      file: `dist/${FILENAME}.min.js`,
      format: 'umd',
      name: GLOBAL_VAR_NAME,
      globals: GLOBALS,
      sourcemap: true,
      exports: 'named', // Explicit named exports
      plugins: [terser()] // Minify only this file
    },
  ],
  plugins: [
    nodeResolve(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: 'dist/types',
      rootDir: 'src',
    }),
  ],
  external: EXTERNAL,
};