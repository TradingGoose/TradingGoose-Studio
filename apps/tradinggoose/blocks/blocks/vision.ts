import { EyeIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getDefaultModel, getModelGroups, getModelOptions } from '@/stores/model-registry'
import type { VisionResponse } from '@/tools/vision/types'

export const VisionBlock: BlockConfig<VisionResponse> = {
  type: 'vision',
  name: 'Vision',
  description: 'Analyze images with vision models',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Vision into the workflow. Can analyze images with vision models.',
  docsLink: 'https://docs.tradinggoose.ai/tools/vision',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: EyeIcon,
  subBlocks: [
    // Image file upload (basic mode)
    {
      id: 'imageFile',
      title: 'Image File',
      type: 'file-upload',
      layout: 'full',
      canonicalParamId: 'imageFile',
      placeholder: 'Upload an image file',
      mode: 'basic',
      multiple: false,
      required: false,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
    },
    // Image file reference (advanced mode)
    {
      id: 'imageFileReference',
      title: 'Image File Reference',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'imageFile',
      placeholder: 'Reference an image from previous blocks',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'imageUrl',
      title: 'Image URL (alternative)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Or enter publicly accessible image URL',
      required: false,
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'combobox',
      layout: 'half',
      dropdownMode: 'sidebar',
      autoSelectFirstOption: false,
      optionGroups: getModelGroups,
      options: getModelOptions,
      value: getDefaultModel,
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter prompt for image analysis',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      description: 'Leave unset to use the configured Mastra connection.',
    },
  ],
  tools: {
    access: ['vision_tool'],
  },
  inputs: {
    apiKey: { type: 'string', description: 'Provider API key' },
    imageUrl: { type: 'string', description: 'Image URL' },
    imageFile: { type: 'json', description: 'Image file (UserFile)' },
    imageFileReference: { type: 'json', description: 'Image file reference' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
  outputs: {
    content: { type: 'string', description: 'Analysis result' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'json', description: 'Reported prompt, completion and total tokens' },
  },
}
