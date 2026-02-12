#!/usr/bin/env bun

import { ApiClient, ConnectionConfig, Template } from 'e2b'

const DEFAULT_ALIAS = 'tradinggoose-pinets'
const DEFAULT_BASE_TEMPLATE = 'code-interpreter-v1'
const DEFAULT_PINETS_VERSION = '0.8.8'
const TEMPLATE_LOOKUP_ATTEMPTS = 10
const TEMPLATE_LOOKUP_DELAY_MS = 1000

type CliOptions = {
  alias: string
  baseTemplate: string
  pinetsVersion: string
  cpuCount?: number
  memoryMB?: number
  dryRun: boolean
  json: boolean
  quiet: boolean
  help: boolean
}

const HELP_TEXT = `
Build an E2B template with PineTS preinstalled and print template ID.

Usage:
  bun run scripts/create-e2b-pinets-template.ts [options]

Options:
  -a, --alias <name>             Template alias (default: ${DEFAULT_ALIAS})
      --base-template <name>     Base template to build from (default: ${DEFAULT_BASE_TEMPLATE})
      --pinets-version <ver>     PineTS version to install (default: ${DEFAULT_PINETS_VERSION})
      --cpu <count>              Optional template CPU count
      --memory <mb>              Optional template memory (MB)
      --dry-run                  Print generated template JSON only
      --json                     Output final result as JSON
      --quiet                    Reduce build log output
  -h, --help                     Show this help

Required environment variables:
  E2B_API_KEY                    E2B API key for template build/list operations

Optional environment variables:
  E2B_DOMAIN                     Custom E2B domain
`.trim()

const parsePositiveInt = (raw: string, flag: string): number => {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return value
}

const requireValue = (raw: string | undefined, flag: string): string => {
  if (!raw || raw.trim().length === 0) {
    throw new Error(`${flag} requires a value`)
  }
  return raw.trim()
}

const parseOptions = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    alias: DEFAULT_ALIAS,
    baseTemplate: DEFAULT_BASE_TEMPLATE,
    pinetsVersion: DEFAULT_PINETS_VERSION,
    dryRun: false,
    json: false,
    quiet: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '-h' || arg === '--help') {
      options.help = true
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg === '--quiet') {
      options.quiet = true
      continue
    }

    if (arg === '-a' || arg === '--alias') {
      options.alias = requireValue(argv[i + 1], '--alias')
      i += 1
      continue
    }

    if (arg.startsWith('--alias=')) {
      options.alias = requireValue(arg.slice('--alias='.length), '--alias')
      continue
    }

    if (arg === '--base-template') {
      options.baseTemplate = requireValue(argv[i + 1], '--base-template')
      i += 1
      continue
    }

    if (arg.startsWith('--base-template=')) {
      options.baseTemplate = requireValue(arg.slice('--base-template='.length), '--base-template')
      continue
    }

    if (arg === '--pinets-version') {
      options.pinetsVersion = requireValue(argv[i + 1], '--pinets-version')
      i += 1
      continue
    }

    if (arg.startsWith('--pinets-version=')) {
      options.pinetsVersion = requireValue(arg.slice('--pinets-version='.length), '--pinets-version')
      continue
    }

    if (arg === '--cpu') {
      options.cpuCount = parsePositiveInt(requireValue(argv[i + 1], '--cpu'), '--cpu')
      i += 1
      continue
    }

    if (arg.startsWith('--cpu=')) {
      options.cpuCount = parsePositiveInt(requireValue(arg.slice('--cpu='.length), '--cpu'), '--cpu')
      continue
    }

    if (arg === '--memory') {
      options.memoryMB = parsePositiveInt(requireValue(argv[i + 1], '--memory'), '--memory')
      i += 1
      continue
    }

    if (arg.startsWith('--memory=')) {
      options.memoryMB = parsePositiveInt(
        requireValue(arg.slice('--memory='.length), '--memory'),
        '--memory'
      )
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

const findTemplateIdByAlias = async (client: ApiClient, alias: string): Promise<string> => {
  for (let attempt = 1; attempt <= TEMPLATE_LOOKUP_ATTEMPTS; attempt += 1) {
    const response = await client.api.GET('/templates')
    if (response.error) {
      throw new Error(`Failed to list E2B templates: ${JSON.stringify(response.error)}`)
    }

    const templates = response.data ?? []
    const matches = templates
      .filter((template) => Array.isArray(template.aliases) && template.aliases.includes(alias))
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt ?? b.createdAt ?? '1970-01-01T00:00:00.000Z') -
          Date.parse(a.updatedAt ?? a.createdAt ?? '1970-01-01T00:00:00.000Z')
      )

    const latest = matches[0]
    if (latest?.templateID) {
      return latest.templateID
    }

    if (attempt < TEMPLATE_LOOKUP_ATTEMPTS) {
      await Bun.sleep(TEMPLATE_LOOKUP_DELAY_MS)
    }
  }

  throw new Error(`Template with alias "${alias}" was not found after build`)
}

async function main() {
  const options = parseOptions(Bun.argv.slice(2))
  if (options.help) {
    console.log(HELP_TEXT)
    return
  }

  const template = Template()
    .fromTemplate(options.baseTemplate)
    .npmInstall([`pinets@${options.pinetsVersion}`])

  if (options.dryRun) {
    const templateJson = await Template.toJSON(template)
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            alias: options.alias,
            baseTemplate: options.baseTemplate,
            pinetsVersion: options.pinetsVersion,
            templateJson: JSON.parse(templateJson),
          },
          null,
          2
        )
      )
      return
    }

    console.log(`alias: ${options.alias}`)
    console.log(`base_template: ${options.baseTemplate}`)
    console.log(`pinets_version: ${options.pinetsVersion}`)
    console.log('')
    console.log(templateJson)
    return
  }

  const apiKey = process.env.E2B_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('E2B_API_KEY is required')
  }

  const domain = process.env.E2B_DOMAIN?.trim()
  const config = new ConnectionConfig({
    apiKey,
    ...(domain ? { domain } : {}),
  })

  if (!options.quiet) {
    console.log(
      `Building template alias "${options.alias}" from "${options.baseTemplate}" with pinets@${options.pinetsVersion}`
    )
  }

  await Template.build(template, {
    alias: options.alias,
    apiKey,
    ...(domain ? { domain } : {}),
    ...(typeof options.cpuCount === 'number' ? { cpuCount: options.cpuCount } : {}),
    ...(typeof options.memoryMB === 'number' ? { memoryMB: options.memoryMB } : {}),
    ...(options.quiet ? {} : { onBuildLogs: (entry) => console.log(entry.toString()) }),
  })

  const client = new ApiClient(config, { requireApiKey: true })
  const templateId = await findTemplateIdByAlias(client, options.alias)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          alias: options.alias,
          templateId,
          pinetsVersion: options.pinetsVersion,
          baseTemplate: options.baseTemplate,
        },
        null,
        2
      )
    )
    return
  }

  console.log(`Template alias: ${options.alias}`)
  console.log(`Template ID: ${templateId}`)
  console.log(`TEMPLATE_ID=${templateId}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to build E2B PineTS template: ${message}`)
  process.exit(1)
})
