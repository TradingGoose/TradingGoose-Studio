import { getProviderIcon } from '@/lib/ui/provider-icon'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const OpenAIBlock: BlockConfig = {
  type: 'openai',
  name: 'Embeddings',
  description: 'Generate Open AI embeddings',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate embeddings from exact input text. Select a listed OpenAI embedding model using its full provider/model identifier. Inputs above the selected model limit are rejected. Reported token counts and available USD costs accompany the vectors.',
  category: 'tools',
  docsLink: 'https://docs.tradinggoose.ai/tools/openai',
  bgColor: undefined,
  icon: getProviderIcon('openai'),
  subBlocks: [
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter text to generate embeddings for',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'full',
      fetchOptions: async () => {
        const response = await fetch('/api/models?type=embedding')
        if (!response.ok) throw new Error('Unable to load listed embedding models')
        const { models } = await response.json()
        return models
          .filter((model: { provider: string }) => model.provider === 'openai')
          .map((model: { id: string }) => ({ id: model.id, label: model.id }))
      },
      value: () => 'openai/text-embedding-3-small',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['openai_embeddings'],
  },
  inputs: {
    input: { type: 'string', description: 'Text to embed' },
    model: { type: 'string', description: 'Embedding model' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    embeddings: { type: 'json', description: 'Generated embeddings' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Reported prompt and total tokens' },
  },
}
