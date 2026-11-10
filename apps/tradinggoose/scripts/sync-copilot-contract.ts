import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compile } from 'json-schema-to-typescript'

const directory = new URL('../lib/copilot/native/contract/', import.meta.url)
const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8')) as {
  protocolRevision: string
  files: Array<{ path: string; sourcePath: string; sha256: string }>
}
const check = process.argv.includes('--check')
const source = process.argv.find((argument) => argument.startsWith('--source='))?.slice(9)
if (source && check) throw new Error('--source and --check are separate operations')

const verifiedFiles = await Promise.all(
  provenance.files.map(async (file) => {
    for (const path of [file.path, file.sourcePath]) {
      if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '..'))
        throw new Error('Canonical contract paths must remain relative to their declared roots')
    }
    const bytes = await readFile(
      source ? resolve(source, file.sourcePath) : new URL(file.path, directory)
    )
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`Canonical Copilot contract mismatch: ${file.path}`)
    }
    return { file, bytes }
  })
)
// Validate the whole owner batch before replacing any local canonical asset.
if (source) {
  for (const { file, bytes } of verifiedFiles) await writeFile(new URL(file.path, directory), bytes)
}

const schema = JSON.parse(await readFile(new URL('contract.schema.json', directory), 'utf8'))
const protocol = JSON.parse(await readFile(new URL('protocol.json', directory), 'utf8'))
const declarations = await compile(schema, 'CopilotNativeTransportContract', {
  unreachableDefinitions: true,
  unknownAny: true,
  bannerComment: `/** Generated from accepted ${provenance.protocolRevision}. Run generate:copilot-contract; do not edit. */`,
  style: { singleQuote: true, semi: false, tabWidth: 2 },
})
const definitions = Object.keys(schema.definitions)
if (definitions.some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) {
  throw new Error('Canonical schema definition names must be TypeScript identifiers')
}
type SchemaNode = {
  $ref?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  oneOf?: SchemaNode[]
  anyOf?: SchemaNode[]
  allOf?: SchemaNode[]
}

/** Derive semantic slots from owner refs; never inspect arbitrary business JSON by field name. */
function semanticPaths(
  node: SchemaNode,
  definition: 'FinancialFact' | 'ImagePart',
  seen = new Set<string>()
): string[][] {
  if (node.$ref === `#/definitions/${definition}`) return [[]]
  if (node.$ref) {
    if (seen.has(node.$ref)) return []
    const name = node.$ref.replace('#/definitions/', '')
    if (!node.$ref.startsWith('#/definitions/') || !schema.definitions[name])
      throw new Error(`Unsupported canonical reference ${node.$ref}`)
    return semanticPaths(schema.definitions[name], definition, new Set([...seen, node.$ref]))
  }
  return [
    ...Object.entries(node.properties ?? {}).flatMap(([key, value]) =>
      semanticPaths(value, definition, seen).map((path) => [key, ...path])
    ),
    ...(node.items
      ? semanticPaths(node.items, definition, seen).map((path) => ['*', ...path])
      : []),
    ...[...(node.oneOf ?? []), ...(node.anyOf ?? []), ...(node.allOf ?? [])].flatMap((value) =>
      semanticPaths(value, definition, seen)
    ),
  ]
}

const semanticSlots = (name: string) =>
  Object.fromEntries(
    ['FinancialFact', 'ImagePart'].map((definition) => [
      definition,
      [
        ...new Map(
          semanticPaths(
            { $ref: `#/definitions/${name}` },
            definition as 'FinancialFact' | 'ImagePart'
          ).map((path) => [JSON.stringify(path), path])
        ).values(),
      ],
    ])
  )
const generated = `${declarations}\nexport interface NativeContractDefinitions {\n${definitions.map((name) => `  ${name}: ${name}`).join('\n')}\n}\n`
const commands = protocol.methods.find(
  (method: { request: string }) => method.request === 'CopilotRequest'
)?.commands
if (!commands) throw new Error('Canonical Copilot command responses are missing')
const commandStatuses = Object.fromEntries(
  Object.entries(commands).map(([command, responses]) => [
    command,
    [
      ...new Set(
        (responses as string[]).flatMap((name) => {
          const status = schema.definitions[name]?.properties?.status
          const values = typeof status?.const === 'string' ? [status.const] : status?.enum
          if (!Array.isArray(values) || !values.every((value) => typeof value === 'string'))
            throw new Error(`Canonical ${name} has no supported response status`)
          return values
        })
      ),
    ],
  ])
)
const annotations = Object.keys(schema).filter((name) => name.startsWith('x-'))
const schemaType = `ReturnType<typeof standardSchemaToJSONSchema>${
  annotations.length
    ? ` & Record<${annotations.map((name) => JSON.stringify(name)).join(' | ')}, unknown>`
    : ''
}`
const outputs = new Map([
  ['contract.generated.d.ts', generated],
  [
    'version.generated.ts',
    `/** Generated from the accepted canonical protocol/schema; do not edit. */\nexport const COPILOT_NATIVE_REVISION = ${JSON.stringify(protocol.protocolRevision)} as const\nexport const COPILOT_NATIVE_API_VERSION = ${JSON.stringify(protocol.apiVersion)} as const\nexport const COPILOT_NATIVE_COMMAND_STATUSES = ${JSON.stringify(commandStatuses, null, 2)} as const\n`,
  ],
  [
    'schema.generated.ts',
    `/** Generated from the hash-verified canonical JSON Schema; do not edit. */\nimport type { standardSchemaToJSONSchema } from '@mastra/core/schema'\nexport const nativeSchema: ${schemaType} = ${JSON.stringify(schema, null, 2)}\n`,
  ],
  [
    'parsers.generated.ts',
    `/** Generated definition bindings and owner-schema semantic slots; do not edit. */\nimport type * as Contract from './contract.generated'\nimport { createNativeParser } from './parser'\nexport const nativeParsers: { [K in keyof Contract.NativeContractDefinitions]: (value: unknown) => Promise<Contract.NativeContractDefinitions[K]> } = {\n${definitions.map((name) => `  ${name}: createNativeParser<Contract.${name}>('${name}', ${JSON.stringify(semanticSlots(name))}),`).join('\n')}\n}\n`,
  ],
])
for (const [name, contents] of outputs) {
  const output = new URL(`../${name}`, directory)
  if (check) {
    if ((await readFile(output, 'utf8')) !== contents) {
      throw new Error(`Generated Copilot ${name} has drifted; run generate:copilot-contract`)
    }
  } else {
    await writeFile(output, contents)
  }
}
console.info(`Canonical ${provenance.protocolRevision} ${check ? 'verified' : 'generated'}`)
