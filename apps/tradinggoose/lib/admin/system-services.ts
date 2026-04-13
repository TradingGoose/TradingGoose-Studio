import { z } from 'zod'
import { getSystemServiceDefinitions } from '@/lib/system-services/catalog'
import {
  listSystemServices,
  SystemServiceValidationError,
  upsertSystemServiceConfig,
} from '@/lib/system-services/service'

export const adminSystemServiceCredentialSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
  hasValue: z.boolean(),
})

export const adminSystemServiceUpdateSchema = z.object({
  serviceId: z.string().trim().min(1),
  credentials: z.array(adminSystemServiceCredentialSchema),
  settings: z.array(
    z.object({
      key: z.string().trim().min(1),
      value: z.string(),
      hasValue: z.boolean(),
    })
  ),
})

export type AdminSystemServiceCredentialInput = z.infer<typeof adminSystemServiceCredentialSchema>
export type AdminSystemServiceUpdateInput = z.infer<typeof adminSystemServiceUpdateSchema>

export { SystemServiceValidationError }

export async function listAdminSystemServices() {
  const definitions = getSystemServiceDefinitions()
  const state = await listSystemServices()
  const stateById = new Map(state.map((service) => [service.id, service]))

  return {
    services: definitions.map((definition) => {
      const current = stateById.get(definition.id)
      return {
        id: definition.id,
        displayName: definition.displayName,
        description: definition.description,
        credentials: definition.credentialFields.map((field) => ({
          key: field.key,
          label: field.label,
          description: field.description,
          value: '',
          required: field.required !== false,
          hasValue:
            current?.credentials.find((credential) => credential.key === field.key)?.hasValue ??
            false,
        })),
        settings: definition.settingFields.map((field) => {
          const currentSetting = current?.settings.find((setting) => setting.key === field.key)
          return {
            key: field.key,
            label: field.label,
            description: field.description,
            type: field.type,
            value: currentSetting?.storedValue ?? '',
            required: field.required !== false,
            hasValue: currentSetting?.hasValue ?? false,
            defaultValue:
              field.defaultValue === undefined || field.defaultValue === null
                ? ''
                : String(field.defaultValue),
          }
        }),
      }
    }),
  }
}

export async function updateAdminSystemService(input: AdminSystemServiceUpdateInput) {
  await upsertSystemServiceConfig({
    serviceId: input.serviceId,
    credentials: input.credentials,
    settings: input.settings,
  })

  return listAdminSystemServices()
}
