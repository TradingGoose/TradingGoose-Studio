export function getTrelloApiKey(params: { apiKey?: string }) {
  const apiKey = params.apiKey?.trim() || ''
  if (!apiKey) {
    throw new Error('Trello API key is not configured in system integrations')
  }

  return apiKey
}
