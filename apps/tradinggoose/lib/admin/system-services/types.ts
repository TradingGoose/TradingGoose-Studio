export interface AdminSystemServiceCredential {
  key: string
  label: string
  description: string
  value: string
  hasValue: boolean
  required: boolean
}

export interface AdminSystemServiceSetting {
  key: string
  label: string
  description: string
  type: 'text' | 'url' | 'number' | 'boolean'
  value: string
  hasValue: boolean
  defaultValue: string
  required: boolean
}

export interface AdminSystemService {
  id: string
  displayName: string
  description: string
  credentials: AdminSystemServiceCredential[]
  settings: AdminSystemServiceSetting[]
}

export interface AdminSystemServicesSnapshot {
  services: AdminSystemService[]
}
