import type { InferPageType } from 'fumadocs-core/source'
import type { source } from '@/lib/source'

export function getLLMText(page: InferPageType<typeof source>) {
  const text = page.data._exports.llmText
  if (typeof text !== 'string') {
    throw new Error(`Missing compiled LLM text for ${page.url}`)
  }

  return `# ${page.data.title}
URL: ${page.url}

${page.data.description || ''}

${text}`
}
