// rollup.config.js
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

// Define names once to ensure consistency
const FILENAME = 'lightweight-charts-line-tools-core';
const GLOBAL_VAR_NAME = 'LightweightChartsLineToolsCore';

const GLOBALS = {
  'lightweight-charts': 'LightweightCharts'
};

const EXTERNAL = [
  'lightweight-charts'
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
    },
    // 3. UMD Production (Browser <script> tag - Minified, No Fluff)
    {
      file: `dist/${FILENAME}.min.js`,
      format: 'umd', // UMD is standard for minified browser scripts
      name: GLOBAL_VAR_NAME,
      globals: GLOBALS,
      sourcemap: true,
      plugins: [terser()] // Minify only this file
    },
  ],
  plugins: [
    resolve(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,       
      declarationDir: 'dist/types', // Puts the type definitions in their own folder
      rootDir: 'src',
    }),
  ],
  external: EXTERNAL,
};