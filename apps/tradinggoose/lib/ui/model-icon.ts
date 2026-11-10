import {
  AnthropicIcon,
  AzureIcon,
  BedrockIcon,
  CerebrasIcon,
  DeepseekIcon,
  FireworksIcon,
  GeminiIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  VertexIcon,
  xAIIcon,
} from '@/components/icons'

/** Presentation only; model routing and capabilities belong to Mastra. */
export function getModelIcon(model: string) {
  const icons: Record<string, typeof OpenAIIcon> = {
    anthropic: AnthropicIcon,
    azure: AzureIcon,
    'aws-bedrock': BedrockIcon,
    cerebras: CerebrasIcon,
    deepseek: DeepseekIcon,
    fireworks: FireworksIcon,
    google: GeminiIcon,
    groq: GroqIcon,
    mistral: MistralIcon,
    ollama: OllamaIcon,
    openai: OpenAIIcon,
    openrouter: OpenRouterIcon,
    'google-vertex': VertexIcon,
    'x-ai': xAIIcon,
    xai: xAIIcon,
  }
  return icons[model.split('/')[0]]
}
