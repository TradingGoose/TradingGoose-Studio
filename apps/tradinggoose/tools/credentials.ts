export function getCredentialRouteParams<T extends Record<string, any>>(params: T) {
  const credentialId = typeof params.credential === 'string' ? params.credential : undefined

  return { credentialId }
}
