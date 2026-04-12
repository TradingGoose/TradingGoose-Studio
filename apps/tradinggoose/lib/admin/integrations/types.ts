export interface AdminIntegrationDefinition {
  id: string
  parentId: string | null
  displayName: string
  isEnabled: boolean | null
}

export interface AdminIntegrationSecret {
  id: string
  definitionId: string
  credentialKey: string
  value: string
  hasValue: boolean
}

export interface AdminIntegrationsSnapshot {
  definitions: AdminIntegrationDefinition[]
  secrets: AdminIntegrationSecret[]
}
