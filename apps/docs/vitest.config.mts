import { fileURLToPath } from 'node:url'

export default {
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
}
