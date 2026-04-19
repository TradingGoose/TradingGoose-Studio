/// <reference types="vitest" />
import path, { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'

const { loadEnvConfig } = nextEnv
const projectDir = process.cwd()
const configDir = dirname(fileURLToPath(import.meta.url))
loadEnvConfig(projectDir)

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@tradinggoose/db': resolve(configDir, '../../packages/db'),
    },
  },
  resolve: {
    alias: [
      {
        find: '@tradinggoose/db',
        replacement: path.resolve(configDir, '../../packages/db'),
      },
      {
        find: '@/lib/logs/console/logger',
        replacement: path.resolve(configDir, 'lib/logs/console/logger.ts'),
      },
      {
        find: '@/stores/console/store',
        replacement: path.resolve(configDir, 'stores/console/store.ts'),
      },
      {
        find: '@/stores/execution/store',
        replacement: path.resolve(configDir, 'stores/execution/store.ts'),
      },
      {
        find: '@/blocks/types',
        replacement: path.resolve(configDir, 'blocks/types.ts'),
      },
      {
        find: '@/serializer/types',
        replacement: path.resolve(configDir, 'serializer/types.ts'),
      },
      { find: '@/lib', replacement: path.resolve(configDir, 'lib') },
      { find: '@/stores', replacement: path.resolve(configDir, 'stores') },
      {
        find: '@/components',
        replacement: path.resolve(configDir, 'components'),
      },
      { find: '@/app', replacement: path.resolve(configDir, 'app') },
      { find: '@/api', replacement: path.resolve(configDir, 'app/api') },
      {
        find: '@/executor',
        replacement: path.resolve(configDir, 'executor'),
      },
      {
        find: '@/providers',
        replacement: path.resolve(configDir, 'providers'),
      },
      { find: '@/tools', replacement: path.resolve(configDir, 'tools') },
      { find: '@/blocks', replacement: path.resolve(configDir, 'blocks') },
      {
        find: '@/serializer',
        replacement: path.resolve(configDir, 'serializer'),
      },
      { find: '@', replacement: path.resolve(configDir) },
    ],
  },
})
