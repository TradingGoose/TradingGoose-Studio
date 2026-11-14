import { TranslateIcon } from '@/components/icons/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { modelApiKeyField, modelField } from '@/stores/model-registry'

const getTranslationPrompt = (
  targetLanguage: string
) => `You are a highly skilled translator. Your task is to translate the given text into ${targetLanguage || 'English'} while:
1. Preserving the original meaning and nuance
2. Maintaining appropriate formality levels
3. Adapting idioms and cultural references appropriately
4. Preserving formatting and special characters
5. Handling technical terms accurately

Only return the translated text without any explanations or notes. The translation should be natural and fluent in ${targetLanguage || 'English'}.`

export const TranslateBlock: BlockConfig = {
  type: 'translate',
  name: 'Translate',
  description: 'Translate text to any language',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Translate text to any language. The model list comes from the configured Mastra registry.',
  docsLink: 'https://docs.tradinggoose.ai/tools/translate',
  category: 'tools',
  bgColor: '',
  icon: TranslateIcon,
  subBlocks: [
    {
      id: 'context',
      title: 'Text to Translate',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the text you want to translate',
      required: true,
    },
    {
      id: 'targetLanguage',
      title: 'Translate To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter language (e.g. Spanish, French, etc.)',
      required: true,
    },
    modelField,
    modelApiKeyField,
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'code',
      layout: 'full',
      language: 'plaintext',
      hidden: true,
      value: (params: Record<string, any>) => {
        return getTranslationPrompt(params.targetLanguage || 'English')
      },
    },
  ],
  tools: { access: ['llm_chat'], config: { tool: () => 'llm_chat' } },
  inputs: {
    context: { type: 'string', description: 'Text to translate' },
    targetLanguage: { type: 'string', description: 'Target language' },
    apiKey: { type: 'string', description: 'Provider API key' },
    systemPrompt: { type: 'string', description: 'Translation instructions' },
  },
  outputs: {
    content: { type: 'string', description: 'Translated text' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Token usage' },
  },
}
