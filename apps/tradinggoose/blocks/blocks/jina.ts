import { JinaAIIcon } from '@/components/icons/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { buildInputsFromToolParams } from '@/blocks/utils'
import { readUrlTool } from '@/tools/jina/read_url'
import type { ReadUrlResponse } from '@/tools/jina/types'

export const JinaBlock: BlockConfig<ReadUrlResponse> = {
  type: 'jina',
  name: 'Jina',
  description: 'Convert website content into text',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Jina into the workflow. Extracts content from websites.',
  docsLink: 'https://docs.tradinggoose.ai/tools/jina',
  category: 'tools',
  bgColor: undefined,
  icon: JinaAIIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter URL to extract content from',
    },
    {
      id: 'options',
      title: 'Options',
      type: 'checkbox-list',
      layout: 'full',
      options: [
        { label: 'Use Reader LM v2', id: 'useReaderLMv2' },
        { label: 'Gather Links', id: 'gatherLinks' },
        { label: 'JSON Response', id: 'jsonResponse' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter your Jina API key',
      password: true,
    },
  ],
  tools: {
    access: ['jina_read_url'],
  },
  inputs: buildInputsFromToolParams(readUrlTool.params),
  outputs: {
    content: { type: 'string', description: 'Extracted content' },
  },
}
