import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

export const { GET } = createFromSource(source, {
  localeMap: {
    // Orama doesn't support `zh` directly; fall back to a generic tokenizer so
    // the Chinese index can still be generated during build.
    zh: 'english',
  },
})
