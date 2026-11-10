import { type standardSchemaToJSONSchema, toStandardSchema } from '@mastra/core/schema'
import type { CopilotFileAttachment } from '@/lib/uploads/contexts/copilot/copilot-file-manager'
import type { CopilotAccessLevel } from '../access-policy'
import type { CopilotRequest, Input } from './contract'
import { nativeSchema } from './schema.generated'

type StudioRequest<T> = T extends CopilotRequest
  ? Omit<T, 'protocolRevision' | 'scope' | 'toolManifest' | 'input'> & {
      workspaceId: string | null
    } & (T extends { command: 'message' }
        ? {
            input: Omit<Input, 'content'> & { content: Extract<Input['content'], string> }
            accessLevel?: CopilotAccessLevel
            fileAttachments?: CopilotFileAttachment[]
          }
        : unknown)
  : never
export type StudioNativeCommand = StudioRequest<CopilotRequest>
type JSONSchema = ReturnType<typeof standardSchemaToJSONSchema>

function requireObjectSchema(schema: JSONSchema | boolean | undefined): JSONSchema {
  if (!schema || typeof schema !== 'object') throw new Error('Canonical command schema is missing')
  return schema
}
const workspace = (() => {
  const value = requireObjectSchema(nativeSchema.definitions?.Scope).properties?.workspaceId
  if (value === undefined) throw new Error('Canonical nullable workspace schema is missing')
  return value
})()
const browserInput = (() => {
  const input = requireObjectSchema(nativeSchema.definitions?.Input)
  const content = requireObjectSchema(input.properties?.content)
  const strings = (content.oneOf ?? []).filter(
    (branch) => typeof branch === 'object' && branch.type === 'string'
  )
  if (strings.length !== 1) throw new Error('Canonical string input branch is missing')
  return { ...input, properties: { ...input.properties, content: strings[0]! } }
})()

/** Remove only server-authored envelope fields. Every command-specific property stays derived. */
function deriveStudioCommand(source: JSONSchema | boolean): JSONSchema {
  const value = requireObjectSchema(source)
  if (value.oneOf) return { ...value, oneOf: value.oneOf.map(deriveStudioCommand) }
  if (value.type !== 'object') throw new Error('Unexpected canonical command envelope')
  const {
    protocolRevision: _revision,
    scope: _scope,
    toolManifest: _manifest,
    ...properties
  } = value.properties ?? {}
  const command = properties.command
  properties.workspaceId = workspace
  if (typeof command === 'object' && command.const === 'message') {
    properties.accessLevel = { enum: ['limited', 'full'] }
    properties.fileAttachments = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'sourceProof'],
        properties: {
          key: { type: 'string', minLength: 1 },
          sourceProof: { type: 'string', minLength: 1 },
          filename: { type: 'string' },
          media_type: { type: 'string' },
          size: { type: 'integer', minimum: 1 },
        },
      },
    }
  }
  return {
    ...value,
    properties,
    required: [
      ...(value.required ?? []).filter(
        (key) => !['protocolRevision', 'scope', 'toolManifest'].includes(key)
      ),
      'workspaceId',
    ],
  }
}
const validator = toStandardSchema<StudioNativeCommand>({
  $schema: nativeSchema.$schema,
  definitions: { ...nativeSchema.definitions, Input: browserInput },
  ...deriveStudioCommand(requireObjectSchema(nativeSchema.definitions?.CopilotRequest)),
})

export async function parseStudioNativeCommand(value: unknown): Promise<StudioNativeCommand> {
  const result = await validator['~standard'].validate(value)
  if (result.issues) throw new Error('Invalid Studio native command')
  return result.value
}
