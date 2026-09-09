import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

export const { GET } = createFromSource(source, {
  localeMap: {
    // Orama does not support `zh`; keep the existing generic tokenizer mapping.
    zh: 'english',
  },
})
