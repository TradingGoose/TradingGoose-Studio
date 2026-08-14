export function shouldRenderAssistantOptions(input: {
  role: string
  isLastMessage: boolean
  hasOptions: boolean
}): boolean {
  return input.role === 'assistant' && input.isLastMessage && input.hasOptions
}
