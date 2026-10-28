export function parseAgentStructuredResponse(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('Agent response format requires a valid JSON object')
  }
}
