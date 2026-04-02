import fs from 'fs'
import path from 'path'

export interface TriggerConfig {
  id: string
  name: string
  provider: string
  description: string
  subBlocks: Array<{
    id: string
    title?: string
    type: string
    placeholder?: string
    description?: string
    required?: boolean
    password?: boolean
    options?: Array<{ label: string; id: string }>
    defaultValue?: string | number | boolean
  }>
  outputs: Record<string, any>
  hasWebhook: boolean
  webhookMethod?: string
}

const ESC = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Scan all trigger directories and extract trigger configs.
 */
export function extractAllTriggers(triggersDir: string): TriggerConfig[] {
  if (!fs.existsSync(triggersDir)) return []

  const triggers: TriggerConfig[] = []
  const dirs = fs.readdirSync(triggersDir).filter((d) => {
    const full = path.join(triggersDir, d)
    return fs.statSync(full).isDirectory() && !['blocks', 'core'].includes(d)
  })

  for (const dir of dirs) {
    const fullDir = path.join(triggersDir, dir)
    const tsFiles = fs.readdirSync(fullDir).filter((f) => f.endsWith('.ts') && f !== 'types.ts')

    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(fullDir, file), 'utf-8')
      const configs = extractTriggersFromFile(content, dir)
      triggers.push(...configs)
    }
  }

  console.log(`  Found ${triggers.length} triggers across ${dirs.length} providers`)
  return triggers
}

function extractTriggersFromFile(content: string, provider: string): TriggerConfig[] {
  const triggers: TriggerConfig[] = []

  // Strategy: find top-level objects that have the TriggerConfig shape.
  // Look for: id + name + provider + version all within the first ~200 chars of an object.
  // We anchor on `version:` since only TriggerConfig has it (subBlocks don't).

  // Find all `version: '1.0.0'` or similar in the file
  const versionRegex = /version\s*:\s*['"]\d+\.\d+\.\d+['"]/g
  let vm
  while ((vm = versionRegex.exec(content)) !== null) {
    // Walk backward to find the opening { of this object
    const versionPos = vm.index
    let braceCount = 0
    let objStart = versionPos

    for (let i = versionPos; i >= 0; i--) {
      if (content[i] === '}') braceCount++
      else if (content[i] === '{') {
        if (braceCount === 0) {
          objStart = i
          break
        }
        braceCount--
      }
    }

    // Now find the matching closing } from objStart
    let depth = 1
    let pos = objStart + 1
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++
      else if (content[pos] === '}') depth--
      pos++
    }
    if (depth !== 0) continue

    const objContent = content.substring(objStart, pos)

    // Extract fields from the top level of this object
    const id = extractTopString(objContent, 'id')
    const name = extractTopString(objContent, 'name')
    const desc = extractTopString(objContent, 'description')

    if (!id || !name) continue
    if (triggers.find((t) => t.id === id)) continue

    const outputs = extractOutputs(objContent)
    const hasWebhook = /webhook\s*:\s*\{/.test(objContent)
    const methodMatch = objContent.match(/method\s*:\s*['"](\w+)['"]/)
    const subBlocks = extractTriggerSubBlocks(objContent)

    triggers.push({
      id,
      name,
      provider: extractTopString(objContent, 'provider') || provider,
      description: ESC(desc || ''),
      subBlocks,
      outputs,
      hasWebhook,
      webhookMethod: methodMatch ? methodMatch[1] : undefined,
    })
  }

  return triggers
}

/** Extract a string property from the first ~300 chars of an object (top level only) */
function extractTopString(obj: string, prop: string): string | null {
  // Only search the first part before subBlocks/outputs to avoid matching nested fields
  const searchArea = obj.substring(0, Math.min(obj.length, 500))
  const m =
    searchArea.match(new RegExp(`${prop}\\s*:\\s*'([^']*)'`)) ||
    searchArea.match(new RegExp(`${prop}\\s*:\\s*"([^"]*)"`))
  return m ? m[1] : null
}

function extractOutputs(content: string): Record<string, any> {
  const outputsStart = content.search(/outputs\s*:\s*\{/)
  if (outputsStart === -1) return {}

  const openBrace = content.indexOf('{', outputsStart)
  if (openBrace === -1) return {}

  let depth = 1
  let pos = openBrace + 1
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++
    else if (content[pos] === '}') depth--
    pos++
  }
  if (depth !== 0) return {}

  const outputsStr = content.substring(openBrace + 1, pos - 1)
  return parseOutputFields(outputsStr)
}

function parseOutputFields(content: string): Record<string, any> {
  const result: Record<string, any> = {}

  // Find top-level fields only (not nested inside other fields)
  const fieldRegex = /(\w+)\s*:\s*\{/g
  let m

  while ((m = fieldRegex.exec(content)) !== null) {
    const name = m[1]
    if (['type', 'description', 'items'].includes(name)) continue

    const startPos = m.index + m[0].length - 1
    let depth = 1
    let endPos = startPos + 1
    while (endPos < content.length && depth > 0) {
      if (content[endPos] === '{') depth++
      else if (content[endPos] === '}') depth--
      endPos++
    }
    if (depth !== 0) continue

    const fieldContent = content.substring(startPos + 1, endPos - 1)
    // Check if this field has a direct 'type:' property (leaf node)
    // vs nested objects that happen to contain 'type' (container node)
    // Leaf: { type: 'string', description: '...' }
    // Container: { event_type: { type: 'string' }, channel: { type: 'string' } }
    const beforeFirstBrace = fieldContent.indexOf('{')
    const searchArea = beforeFirstBrace > 0 ? fieldContent.substring(0, beforeFirstBrace) : fieldContent
    const typeMatch = searchArea.match(/\btype\s*:\s*['"]([^'"]+)['"]/)
    const descMatch = searchArea.match(/\bdescription\s*:\s*['"]([^'"]+)['"]/)

    if (typeMatch) {
      // This is a leaf field (has type)
      result[name] = {
        type: typeMatch[1],
        description: descMatch ? ESC(descMatch[1]) : name,
      }
    } else if (descMatch) {
      // Wrapper with description but no type — it's an object container
      result[name] = {
        type: 'object',
        description: ESC(descMatch[1]),
      }
    } else {
      // Nested object without explicit type — recurse to get its children as a flat group
      const nested = parseOutputFields(fieldContent)
      if (Object.keys(nested).length > 0) {
        result[name] = {
          type: 'object',
          description: name,
          ...nested,
        }
      }
    }

    // Skip past this field so we don't re-enter it
    fieldRegex.lastIndex = endPos
  }

  return result
}

function extractTriggerSubBlocks(content: string): TriggerConfig['subBlocks'] {
  const subBlocksStart = content.search(/subBlocks\s*:\s*\[/)
  if (subBlocksStart === -1) return []

  const bracketPos = content.indexOf('[', subBlocksStart)
  if (bracketPos === -1) return []

  let depth = 1
  let pos = bracketPos + 1
  while (pos < content.length && depth > 0) {
    if (content[pos] === '[') depth++
    else if (content[pos] === ']') depth--
    pos++
  }
  if (depth !== 0) return []

  const arrayContent = content.substring(bracketPos + 1, pos - 1)
  const blocks: TriggerConfig['subBlocks'] = []

  let blockDepth = 0
  let blockStart = -1

  for (let i = 0; i < arrayContent.length; i++) {
    if (arrayContent[i] === '{') {
      if (blockDepth === 0) blockStart = i
      blockDepth++
    } else if (arrayContent[i] === '}') {
      blockDepth--
      if (blockDepth === 0 && blockStart >= 0) {
        const blockStr = arrayContent.substring(blockStart, i + 1)
        const parsed = parseTriggerSubBlock(blockStr)
        if (parsed) blocks.push(parsed)
        blockStart = -1
      }
    }
  }

  return blocks
}

function parseTriggerSubBlock(blockStr: string): TriggerConfig['subBlocks'][number] | null {
  const getString = (prop: string): string | undefined => {
    const m =
      blockStr.match(new RegExp(`${prop}\\s*:\\s*'([^']*)'`)) ||
      blockStr.match(new RegExp(`${prop}\\s*:\\s*"([^"]*)"`))
    return m ? m[1] : undefined
  }

  const id = getString('id')
  const type = getString('type')
  if (!id || !type) return null

  // Skip internal fields
  if (/hideFromPreview\s*:\s*true/.test(blockStr)) return null
  if (type === 'trigger-save' || type === 'text') return null
  if (/readOnly\s*:\s*true/.test(blockStr)) return null

  const result: TriggerConfig['subBlocks'][number] = { id, type }

  const title = getString('title')
  const placeholder = getString('placeholder')
  const description = getString('description')

  if (title) result.title = title
  if (placeholder) result.placeholder = ESC(placeholder)
  if (description) result.description = ESC(description)
  if (/required\s*:\s*true/.test(blockStr)) result.required = true
  if (/password\s*:\s*true/.test(blockStr)) result.password = true

  const optionsMatch = blockStr.match(/options\s*:\s*\[([^\]]*)\]/)
  if (optionsMatch) {
    const opts: Array<{ label: string; id: string }> = []
    const re = /\{\s*label\s*:\s*['"]([^'"]+)['"]\s*,\s*id\s*:\s*['"]([^'"]+)['"]/g
    let om
    while ((om = re.exec(optionsMatch[1])) !== null) {
      opts.push({ label: om[1], id: om[2] })
    }
    if (opts.length > 0) result.options = opts
  }

  return result
}
