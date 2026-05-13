export function getCredentialRouteParams<T extends Record<string, any>>(params: T) {
  const credentialId = typeof params.credential === 'string' ? params.credential : undefined
  const workflowId =
    typeof params._context?.workflowId === 'string' ? params._context.workflowId : undefined

  return { credentialId, workflowId }
}
