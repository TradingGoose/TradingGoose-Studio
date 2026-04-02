import type { BlockConfig, DocSubBlock } from './types'
import { extractStringProperty, extractBracedContent } from './utils'

/**
 * Extract block configuration from a block source file.
 */
export function extractBlockConfig(fileContent: string): BlockConfig | null {
  try {
    const exportMatch = fileContent.match(/export\s+const\s+(\w+)Block\s*:/)
    if (!exportMatch) return null

    const blockName = exportMatch[1]
    const type = findBlockType(fileContent, blockName)
    const name = extractStringProperty(fileContent, 'name') || `${blockName} Block`
    const description = extractStringProperty(fileContent, 'description') || ''
    const longDescription = extractStringProperty(fileContent, 'longDescription') || ''
    const category = extractStringProperty(fileContent, 'category') || 'misc'
    const rawBgColor = extractStringProperty(fileContent, 'bgColor')
    const bgColor = rawBgColor && rawBgColor.length > 0 ? rawBgColor : ''
    const iconName = extractIconName(fileContent) || ''
    const outputs = extractOutputs(fileContent)
    const toolsAccess = extractToolsAccess(fileContent)
    const subBlocks = extractSubBlocks(fileContent)
    const operationToolMap = extractOperationToolMap(fileContent)

    return {
      type: type || blockName.toLowerCase(),
      name,
      description,
      longDescription,
      category,
      bgColor,
      iconName,
      outputs,
      tools: { access: toolsAccess },
      subBlocks,
      operationToolMap: Object.keys(operationToolMap).length > 0 ? operationToolMap : undefined,
    }
  } catch (error) {
    console.error('Error extracting block configuration:', error)
    return null
  }
}

// ── Type extraction ───────────────────────────────────────────────

function findBlockType(content: string, blockName: string): string {
  // Try direct regex
  const directMatch = content.match(
    new RegExp(
      `export\\s+const\\s+${blockName}Block\\s*:[^{]*{[\\s\\S]*?type\\s*:\\s*['"]([^'"]+)['"]`,
      'i'
    )
  )
  if (directMatch) return directMatch[1]

  // Try brace-matching
  const exportMatch = content.match(new RegExp(`export\\s+const\\s+${blockName}Block\\s*:`))
  if (exportMatch) {
    const afterExport = content.substring(exportMatch.index! + exportMatch[0].length)
    const blockContent = extractBracedContent(afterExport, 0)
    if (blockContent) {
      const typeMatch = blockContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
      if (typeMatch) return typeMatch[1]
    }
  }

  return blockName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

function extractIconName(content: string): string | null {
  const match = content.match(/icon\s*:\s*(\w+Icon)/)
  return match ? match[1] : null
}

// ── Outputs extraction ────────────────────────────────────────────

function extractOutputs(content: string): Record<string, any> {
  const outputsStart = content.search(/outputs\s*:\s*{/)
  if (outputsStart === -1) return {}

  const outputsContent = extractBracedContent(content, outputsStart)
  if (!outputsContent) return {}

  const outputs: Record<string, any> = {}
  const fieldRegex = /(\w+)\s*:\s*{/g
  let match

  while ((match = fieldRegex.exec(outputsContent)) !== null) {
    const fieldName = match[1]
    const startPos = match.index + match[0].length - 1
    const fieldContent = extractBracedContent(outputsContent, startPos - 1)
    if (!fieldContent) continue

    const typeMatch = fieldContent.match(/type\s*:\s*['"](.*?)['"]/)
    const descMatch = fieldContent.match(/description\s*:\s*['"](.*?)['"]/)
    if (typeMatch) {
      outputs[fieldName] = {
        type: typeMatch[1],
        description: descMatch ? descMatch[1] : `${fieldName} output`,
      }
    }
  }

  return outputs
}

// ── Tools access extraction ───────────────────────────────────────

function extractToolsAccess(content: string): string[] {
  const accessMatch = content.match(/access\s*:\s*\[\s*([^\]]+)\s*\]/)
  if (!accessMatch) return []

  const tools: string[] = []
  const toolMatches = accessMatch[1].match(/['"]([^'"]+)['"]/g)
  if (toolMatches) {
    for (const t of toolMatches) {
      const m = t.match(/['"]([^'"]+)['"]/)
      if (m) tools.push(m[1])
    }
  }
  return tools
}

// ── SubBlocks extraction ──────────────────────────────────────────

function extractSubBlocks(content: string): DocSubBlock[] {
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
  const blocks: DocSubBlock[] = []
  let blockDepth = 0
  let blockStart = -1

  for (let i = 0; i < arrayContent.length; i++) {
    if (arrayContent[i] === '{') {
      if (blockDepth === 0) blockStart = i
      blockDepth++
    } else if (arrayContent[i] === '}') {
      blockDepth--
      if (blockDepth === 0 && blockStart >= 0) {
        const parsed = parseSubBlockObject(arrayContent.substring(blockStart, i + 1))
        if (parsed) blocks.push(parsed)
        blockStart = -1
      }
    }
  }

  return blocks
}

function parseSubBlockObject(blockStr: string): DocSubBlock | null {
  const getString = (prop: string): string | undefined => {
    const m =
      blockStr.match(new RegExp(`${prop}\\s*:\\s*'([^']*)'`)) ||
      blockStr.match(new RegExp(`${prop}\\s*:\\s*"([^"]*)"`))
    return m ? m[1] : undefined
  }

  const id = getString('id')
  const type = getString('type')
  if (!id || !type) return null

  // Skip hidden/internal/trigger-only fields
  if (/hidden\s*:\s*true/.test(blockStr)) return null
  if (/hideFromPreview\s*:\s*true/.test(blockStr)) return null
  if (getString('mode') === 'trigger') return null

  const result: DocSubBlock = { id, type }

  const title = getString('title')
  const layout = getString('layout')
  const placeholder = getString('placeholder')
  const description = getString('description')
  const language = getString('language')
  const provider = getString('provider')

  if (title) result.title = title
  if (layout) result.layout = layout
  if (placeholder) result.placeholder = placeholder
  if (description) result.description = description
  if (language) result.language = language
  if (provider) result.provider = provider

  if (/password\s*:\s*true/.test(blockStr)) result.password = true
  if (/required\s*:\s*true/.test(blockStr)) result.required = true

  // Numeric props
  for (const prop of ['min', 'max', 'step'] as const) {
    const m = blockStr.match(new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)`))
    if (m) (result as any)[prop] = Number(m[1])
  }

  // Default value
  const dvStr =
    blockStr.match(/defaultValue\s*:\s*'([^']*)'/) ||
    blockStr.match(/defaultValue\s*:\s*"([^"]*)"/)
  if (dvStr) {
    result.defaultValue = dvStr[1]
  } else if (/defaultValue\s*:\s*true/.test(blockStr)) {
    result.defaultValue = true
  } else if (/defaultValue\s*:\s*false/.test(blockStr)) {
    result.defaultValue = false
  } else {
    const numDv = blockStr.match(/defaultValue\s*:\s*(\d+(?:\.\d+)?)/)
    if (numDv) result.defaultValue = Number(numDv[1])
  }

  // Static options array
  const optionsMatch = blockStr.match(/options\s*:\s*\[([^\]]*)\]/)
  if (optionsMatch) {
    const opts: Array<{ label: string; id: string }> = []
    const re = /\{\s*label\s*:\s*['"]([^'"]+)['"]\s*,\s*id\s*:\s*['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(optionsMatch[1])) !== null) {
      opts.push({ label: m[1], id: m[2] })
    }
    if (opts.length > 0) result.options = opts
  }

  // Condition (e.g., condition: { field: 'operation', value: 'upload' })
  const condMatch = blockStr.match(
    /condition\s*:\s*\{\s*field\s*:\s*['"]([^'"]+)['"]\s*,\s*value\s*:\s*['"]([^'"]+)['"]/
  )
  if (condMatch) {
    result.condition = { field: condMatch[1], value: condMatch[2] }
  } else {
    // Array value condition: condition: { field: 'op', value: ['a', 'b'] }
    const condArrayMatch = blockStr.match(
      /condition\s*:\s*\{\s*field\s*:\s*['"]([^'"]+)['"]\s*,\s*value\s*:\s*\[([^\]]+)\]/
    )
    if (condArrayMatch) {
      const values: string[] = []
      const valRe = /['"]([^'"]+)['"]/g
      let vm
      while ((vm = valRe.exec(condArrayMatch[2])) !== null) {
        values.push(vm[1])
      }
      if (values.length > 0) {
        result.condition = { field: condArrayMatch[1], value: values }
      }
    }
  }

  return result
}

// ── Operation → Tool mapping ──────────────────────────────────────

/**
 * Extract the switch statement in tools.config.tool that maps operation IDs to tool names.
 * e.g., case 'send': return 'slack_message' → { send: 'slack_message' }
 */
function extractOperationToolMap(content: string): Record<string, string> {
  const map: Record<string, string> = {}

  // Find the tool config function with a switch statement
  const switchMatch = content.match(/tool\s*:\s*\(?params\)?\s*=>\s*\{[\s\S]*?switch\s*\(params\.operation\)\s*\{([\s\S]*?)\}\s*\}/)
  if (!switchMatch) {
    // Try simpler pattern: tool: (params) => params.operation (identity mapping)
    if (/tool\s*:\s*\(?params\)?\s*=>\s*params\.operation/.test(content)) {
      // Operation ID is the tool name directly
      const accessMatch = content.match(/access\s*:\s*\[\s*([^\]]+)\s*\]/)
      if (accessMatch) {
        const tools = accessMatch[1].match(/['"]([^'"]+)['"]/g)
        if (tools) {
          for (const t of tools) {
            const m = t.match(/['"]([^'"]+)['"]/)
            if (m) map[m[1]] = m[1]
          }
        }
      }
    }
    return map
  }

  const switchBody = switchMatch[1]
  // Match: case 'operation_id': return 'tool_name'
  const caseRegex = /case\s+['"]([^'"]+)['"]\s*:\s*\n?\s*return\s+['"]([^'"]+)['"]/g
  let m
  while ((m = caseRegex.exec(switchBody)) !== null) {
    map[m[1]] = m[2]
  }

  return map
}
