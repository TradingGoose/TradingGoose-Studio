import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'bun:test'
import { updateMetaJson } from './utils'

const rootDir = path.resolve(import.meta.dir, '../..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradinggoose-doc-gen-'))
const toolDocsDir = path.join(tempDir, 'tools')
const triggerDocsDir = path.join(tempDir, 'triggers')
const widgetDocsDir = path.join(tempDir, 'widgets')
const unsupportedPreviewFields = [
  'serviceId',
  'inputType',
  'multiSelect',
  'multiple',
  'enableSearch',
  'group',
]

afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }))

function snapshot(directory: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(directory)
      .sort()
      .map((file) => [file, fs.readFileSync(path.join(directory, file), 'utf-8')])
  )
}

function expectNoUnsupportedPreviewFields(pages: Record<string, string>) {
  const content = Object.values(pages).join('\n')
  for (const field of unsupportedPreviewFields) expect(content).not.toContain(`"${field}":`)
}

function runGenerator(
  generator: 'tools' | 'triggers' | 'widgets',
  docsOutputPath: string,
  now?: number
) {
  const moduleName =
    generator === 'tools'
      ? 'generate-tools'
      : generator === 'triggers'
        ? 'generate-triggers'
        : 'generate-widgets'
  const exportName =
    generator === 'tools'
      ? 'generateToolDocs'
      : generator === 'triggers'
        ? 'generateTriggerDocs'
        : 'generateWidgetDocs'
  const script = `
    ${now === undefined ? '' : `Date.now = () => ${now}`}
    const { ${exportName} } = await import('./scripts/doc-gen/${moduleName}')
    await ${exportName}({
      rootDir: ${JSON.stringify(rootDir)},
      docsOutputPath: ${JSON.stringify(docsOutputPath)},
    })
  `
  execFileSync(process.execPath, ['-e', script], { cwd: rootDir, stdio: 'pipe' })
}

describe('documentation regeneration boundaries', () => {
  it('preserves curated metadata and page order while reconciling files', () => {
    const docsDir = path.join(tempDir, 'curated-meta')
    fs.mkdirSync(docsDir, { recursive: true })
    fs.writeFileSync(path.join(docsDir, 'index.mdx'), '')
    fs.writeFileSync(path.join(docsDir, 'alpha.mdx'), '')
    fs.writeFileSync(path.join(docsDir, 'beta.mdx'), '')
    fs.writeFileSync(
      path.join(docsDir, 'meta.json'),
      JSON.stringify({ title: 'Curated', pages: ['index', 'beta', 'removed'] })
    )

    updateMetaJson(docsDir)

    expect(JSON.parse(fs.readFileSync(path.join(docsDir, 'meta.json'), 'utf-8'))).toEqual({
      title: 'Curated',
      pages: ['index', 'beta', 'alpha'],
    })
  })

  it('overwrites empty and stale source-backed tool pages on every run', async () => {
    fs.mkdirSync(toolDocsDir, { recursive: true })
    fs.writeFileSync(path.join(toolDocsDir, 'trading_action.mdx'), '')
    fs.writeFileSync(path.join(toolDocsDir, 'historical_data.mdx'), 'STALE UNMARKED CONTENT')
    fs.writeFileSync(path.join(toolDocsDir, 'supplemental-tool.mdx'), 'HAND-WRITTEN TOOL PAGE')

    runGenerator('tools', toolDocsDir, 1_800_000_000_000)
    const first = snapshot(toolDocsDir)

    expect(first['trading_action.mdx']).toContain('title: Trading Action')
    expect(first['trading_action.mdx']).toContain(
      `"description": "Shown when orderSizingMode is not 'notional' and provider is one of 'alpaca', 'tradier'."`
    )
    expect(first['historical_data.mdx']).not.toContain('STALE UNMARKED CONTENT')
    expect(first['supplemental-tool.mdx']).toBe('HAND-WRITTEN TOOL PAGE')
    const googleVault = first['google_vault.mdx']
    const createMatter = googleVault.slice(
      googleVault.indexOf('### Create Matter'),
      googleVault.indexOf('### List Matters')
    )
    const listMatters = googleVault.slice(googleVault.indexOf('### List Matters'))
    expect(createMatter).not.toContain('"id": "matterId"')
    expect(listMatters.match(/"id": "matterId"/g) ?? []).toHaveLength(1)
    expect(first['mcp.mdx']).toContain('| `content` | array |')
    expect(first['mcp.mdx']).toContain('selected MCP server. Shown when server is not')
    expect(first['mcp.mdx']).not.toContain('selected MCP server Shown when')
    expect(first['circleback.mdx']).toContain('| `id` | number |')
    expect(first['circleback.mdx']).toContain('| `meeting` | json |')
    expect(googleVault).toContain('Output (block-level contract)')
    expect(googleVault).toContain('| `output` | json | Vault API response data |')
    expect(googleVault).toContain('| `file` | json | Downloaded export file')
    expect(googleVault).not.toContain('does not declare a structured output schema')
    const translateApiKey =
      first['translate.mdx'].match(/"id": "apiKey",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const translateModel = first['translate.mdx'].match(/"id": "model",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const visionApiKey = first['vision.mdx'].match(/"id": "apiKey",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const historicalApiKey =
      first['historical_data.mdx'].match(/"id": "apiKey",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const vaultExportName =
      first['google_vault.mdx'].match(/"id": "exportName",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const watchlistItems = first['watchlist.mdx'].slice(
      first['watchlist.mdx'].indexOf('### Read List Items')
    )
    const watchlistId = watchlistItems.match(/"id": "watchlistId",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const createContact = first['apollo.mdx'].slice(
      first['apollo.mdx'].indexOf('### Create Contact'),
      first['apollo.mdx'].indexOf('### Update Contact')
    )
    const updateContact = first['apollo.mdx'].slice(
      first['apollo.mdx'].indexOf('### Update Contact'),
      first['apollo.mdx'].indexOf('### Search Contacts')
    )
    const createContactFirstName =
      createContact.match(/"id": "first_name",[\s\S]*?\n {8}}/)?.[0] ?? ''
    const updateContactFirstName =
      updateContact.match(/"id": "first_name",[\s\S]*?\n {8}}/)?.[0] ?? ''
    expect(translateApiKey).not.toBe('')
    expect(translateApiKey).toContain(
      '"description": "Shown when applicable to the selected model at runtime."'
    )
    expect(translateApiKey).not.toContain('none of .')
    expect(translateModel).not.toBe('')
    expect(translateModel).not.toContain('"options"')
    expect(translateApiKey).not.toContain('"required": true')
    expect(first['translate.mdx']).toContain('| `apiKey` | string | No |')
    expect(visionApiKey).toContain('"required": true')
    expect(historicalApiKey).not.toContain('"required": true')
    expect(vaultExportName).toContain('"required": true')
    expect(watchlistId).toContain('"required": true')
    expect(createContactFirstName).toContain('"required": true')
    expect(updateContactFirstName).not.toContain('"required": true')
    expect(Object.values(first).join('\n')).not.toMatch(/is (?:one|none) of \./)
    expectNoUnsupportedPreviewFields(first)

    const generatedPages = Object.keys(first).filter(
      (file) => file.endsWith('.mdx') && file !== 'supplemental-tool.mdx'
    )
    expect(generatedPages).toHaveLength(124)
    generatedPages.forEach((file, index) => {
      fs.writeFileSync(path.join(toolDocsDir, file), index % 2 ? '' : 'STALE TOOL CONTENT')
    })

    runGenerator('tools', toolDocsDir, 1_900_000_000_000)
    expect(snapshot(toolDocsDir)).toEqual(first)
  })

  it('creates missing widget pages from runtime contracts without invented features', () => {
    fs.mkdirSync(widgetDocsDir, { recursive: true })

    runGenerator('widgets', widgetDocsDir)
    const first = snapshot(widgetDocsDir)

    expect(first['list-mcp.mdx']).toContain('title: "MCP Servers"')
    expect(first['list-mcp.mdx']).toContain('List MCP servers.')
    expect(first['list-mcp.mdx']).not.toContain('Search & Filter')
    expect(first['list-mcp.mdx']).not.toContain('/docs/en/')

    runGenerator('widgets', widgetDocsDir)
    expect(snapshot(widgetDocsDir)).toEqual(first)
  })

  it('overwrites registry-backed triggers while preserving hand-written pages', () => {
    fs.mkdirSync(triggerDocsDir, { recursive: true })
    fs.writeFileSync(path.join(triggerDocsDir, 'schedule.mdx'), 'STALE SCHEDULE CONTENT')
    fs.writeFileSync(path.join(triggerDocsDir, 'portfolio.mdx'), 'STALE PORTFOLIO CONTENT')
    fs.writeFileSync(path.join(triggerDocsDir, 'api.mdx'), 'HAND-WRITTEN CORE PAGE')
    fs.writeFileSync(path.join(triggerDocsDir, 'chat.mdx'), 'HAND-WRITTEN CHAT PAGE')
    fs.writeFileSync(path.join(triggerDocsDir, 'input-form.mdx'), 'HAND-WRITTEN FORM PAGE')
    fs.writeFileSync(path.join(triggerDocsDir, 'manual.mdx'), 'HAND-WRITTEN MANUAL PAGE')
    fs.writeFileSync(path.join(triggerDocsDir, 'webhook.mdx'), 'HAND-WRITTEN WEBHOOK PAGE')
    fs.writeFileSync(path.join(triggerDocsDir, 'concept-guide.mdx'), 'HAND-WRITTEN TRIGGER PAGE')

    runGenerator('triggers', triggerDocsDir)
    const first = snapshot(triggerDocsDir)

    expect(first['schedule.mdx']).toContain('**schedule-based** trigger')
    expect(first['schedule.mdx']).not.toContain('STALE SCHEDULE CONTENT')
    expect(first['schedule.mdx']).toContain('does not declare additional output fields')
    expect(first['schedule.mdx']).not.toContain('"condition"')
    expect(first['schedule.mdx']).toContain('"defaultValue": "daily"')
    expect(first['schedule.mdx']).toContain('"defaultValue": "UTC"')
    expect(first['schedule.mdx']).toContain(
      `"description": "Shown when scheduleType is 'minutes'."`
    )
    expect(first['schedule.mdx']).toContain(
      `"description": "Shown when scheduleType is none of 'minutes', 'hourly'."`
    )
    expect(first['portfolio.mdx']).toContain('**polling-based** trigger')
    expect(first['portfolio.mdx']).not.toContain('STALE PORTFOLIO CONTENT')
    expect(first['github.mdx']).toContain('"name": "commits"')
    expect(first['github.mdx']).toContain('"name": "tree_id"')
    expect(first['github.mdx']).toContain('"id": "contentType"')
    expect(first['github.mdx']).not.toContain('"name": "items"')
    expect(first['github.mdx']).not.toContain('"condition"')
    expect(first['github.mdx']).not.toContain('selectedTriggerId')
    expect(first['github.mdx']).not.toContain('"description": "repository"')
    expect(first['slack.mdx']).toContain('<br />')
    expect(first['slack.mdx']).not.toContain('<br>')
    expect(first['whatsapp.mdx']).toContain('<br />')
    expect(first['whatsapp.mdx']).not.toContain('<br>')
    expect(first['whatsapp.mdx']).toContain('<code>messages</code>')
    expect(first['hubspot.mdx']).toContain('&#123;YOUR_APP_ID&#125;')
    expect(first['hubspot.mdx']).not.toContain('{YOUR_APP_ID}')
    for (const [slug, providerName] of [
      ['github', 'GitHub'],
      ['hubspot', 'HubSpot'],
      ['imap', 'IMAP'],
      ['microsoft-teams', 'Microsoft Teams'],
      ['rss', 'RSS'],
      ['whatsapp', 'WhatsApp'],
    ]) {
      expect(first[`${slug}.mdx`]).toContain(`title: ${providerName} Trigger`)
    }
    for (const [slug, providerName] of [
      ['github', 'GitHub'],
      ['hubspot', 'HubSpot'],
      ['microsoft-teams', 'Microsoft Teams'],
      ['whatsapp', 'WhatsApp'],
    ]) {
      expect(first[`${slug}.mdx`]).toContain(`for ${providerName}.`)
    }
    expect(first['calendly.mdx']).toContain('"name": "cancellation"')
    expect(first['calendly.mdx']).toContain('"name": "canceled_by"')
    expect(first['calendly.mdx']).not.toContain('"name": "properties"')
    const calendlyRoutingForm = first['calendly.mdx'].slice(
      first['calendly.mdx'].indexOf('### Calendly Routing Form Submitted')
    )
    expect(calendlyRoutingForm).toContain('"name": "type"')
    expect(first['grain.mdx']).toContain('"name": "type"')
    expect(first['stripe.mdx']).toContain('"name": "type"')
    expect(first['stripe.mdx']).toContain('>Stripe webhook settings</a>')
    expect(first['stripe.mdx']).not.toContain('>https://dashboard.stripe.com/webhooks</a>')
    expect(first['stripe.mdx']).toContain('<code>Webhook Endpoint</code>')
    expect(first['api.mdx']).toBe('HAND-WRITTEN CORE PAGE')
    expect(first['chat.mdx']).toBe('HAND-WRITTEN CHAT PAGE')
    expect(first['input-form.mdx']).toBe('HAND-WRITTEN FORM PAGE')
    expect(first['manual.mdx']).toBe('HAND-WRITTEN MANUAL PAGE')
    expect(first['webhook.mdx']).toBe('HAND-WRITTEN WEBHOOK PAGE')
    expect(first['concept-guide.mdx']).toBe('HAND-WRITTEN TRIGGER PAGE')
    expectNoUnsupportedPreviewFields(first)

    const handWrittenPages = new Set([
      'api.mdx',
      'chat.mdx',
      'input-form.mdx',
      'manual.mdx',
      'webhook.mdx',
      'concept-guide.mdx',
    ])
    const generatedPages = Object.keys(first).filter(
      (file) => file.endsWith('.mdx') && !handWrittenPages.has(file)
    )
    expect(generatedPages).toHaveLength(23)
    generatedPages.forEach((file, index) => {
      fs.writeFileSync(path.join(triggerDocsDir, file), index % 2 ? '' : 'STALE TRIGGER CONTENT')
    })

    runGenerator('triggers', triggerDocsDir)
    expect(snapshot(triggerDocsDir)).toEqual(first)
  })
})
