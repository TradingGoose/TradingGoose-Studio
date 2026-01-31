export const resolveProviderErrorMessage = (payload: any, fallback: string) => {
  const raw = payload?.error
  if (!raw) return fallback
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    const code = typeof raw.code === 'string' ? raw.code : ''
    const message = typeof raw.message === 'string' ? raw.message : fallback
    return code ? `${code}: ${message}` : message
  }
  return fallback
}
