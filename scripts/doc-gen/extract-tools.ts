import fs from 'fs'
import path from 'path'
import type { ToolInfo } from './types'
import { extractBracedContent } from './utils'

interface ToolConfigSource {
  content: string
  id: string
}

export async function getToolInfo(
  toolName: string,
  toolsBasePath: string
): Promise<ToolInfo | null> {
  try {
    const providerDir = resolveProviderDirectory(toolName, toolsBasePath)
    if (!providerDir) return null

    const suffix = toolName.slice(path.basename(providerDir).length + 1)
    const camelSuffix = suffix
      .split('_')
      .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
      .join('')
    const preferred = [`${suffix}.ts`, `${camelSuffix}.ts`, 'index.ts']
    const files = fs
      .readdirSync(providerDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort((left, right) => {
        const leftRank = preferred.indexOf(left)
        const rightRank = preferred.indexOf(right)
        return (
          (leftRank < 0 ? preferred.length : leftRank) -
            (rightRank < 0 ? preferred.length : rightRank) || left.localeCompare(right)
        )
      })

    const matches: Array<{ fileContent: string; config: ToolConfigSource }> = []
    for (const file of files) {
      const fileContent = fs.readFileSync(path.join(providerDir, file), 'utf-8')
      for (const config of extractToolConfigs(fileContent)) {
        if (config.id === toolName) matches.push({ fileContent, config })
      }
    }

    if (matches.length !== 1) return null
    return extractToolInfo(matches[0].config.content, matches[0].fileContent)
  } catch (error) {
    console.error(`Error getting info for tool ${toolName}:`, error)
    return null
  }
}

function resolveProviderDirectory(toolName: string, toolsBasePath: string): string | null {
  const parts = toolName.split('_')
  for (let count = parts.length - 1; count >= 1; count--) {
    const candidate = path.join(toolsBasePath, parts.slice(0, count).join('_'))
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
  }
  return null
}

function extractToolConfigs(fileContent: string): ToolConfigSource[] {
  const configs: ToolConfigSource[] = []
  const declaration = /export\s+const\s+\w+\s*:\s*ToolConfig\s*(?:<[\s\S]*?>\s*)?=\s*\{/g
  let match: RegExpExecArray | null

  while ((match = declaration.exec(fileContent)) !== null) {
    const openBrace = match.index + match[0].lastIndexOf('{')
    const content = extractBracedContent(fileContent, openBrace - 1)
    if (!content) continue
    const boundedContent = `{${content}}`
    const idExpression = extractPropertyExpression(boundedContent, 'id')
    const id = idExpression ? resolveStringExpression(idExpression, fileContent) : null
    if (id) configs.push({ content: boundedContent, id })
    declaration.lastIndex = openBrace + content.length
  }

  return configs
}

function resolveStringExpression(expression: string, fileContent: string): string | null {
  const literal = expression.match(/^['"]([^'"]+)['"]$/)
  if (literal) return literal[1]

  const member = expression.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
  if (!member) return null
  return extractStaticStringMap(fileContent, member[1])?.[member[2]] || null
}

function extractStaticStringMap(
  content: string,
  identifier: string
): Record<string, string> | null {
  const declaration = new RegExp(`(?:export\\s+)?const\\s+${escapeRegExp(identifier)}\\s*=\\s*\\{`)
  const match = declaration.exec(content)
  if (!match) return null
  const openBrace = match.index + match[0].lastIndexOf('{')
  const body = extractBracedContent(content, openBrace - 1)
  if (!body) return null
  const inner = body.replace(/,\s*$/, '')
  const result: Record<string, string> = {}
  const entry =
    /(?:^|,)\s*(?:([A-Za-z_$][\w$]*)|['"]([^'"]+)['"])\s*:\s*['"]([^'"]+)['"]\s*(?=,|$)/g
  let cursor = 0
  let item: RegExpExecArray | null
  while ((item = entry.exec(inner)) !== null) {
    if (inner.slice(cursor, item.index).trim()) return null
    result[item[1] || item[2]] = item[3]
    cursor = entry.lastIndex
  }
  return inner.slice(cursor).trim() || Object.keys(result).length === 0 ? null : result
}

function extractToolInfo(config: string, fileContent: string): ToolInfo {
  const description = extractStringProperty(config, 'description') || 'No description available'
  const params = parseFieldCollection(config, fileContent, 'params', new Set())
  const outputs = Object.fromEntries(
    parseFieldCollection(config, fileContent, 'outputs', new Set()).map((field) => [
      field.name,
      { type: field.type, description: field.description },
    ])
  )
  return { description, params, outputs }
}

function parseFieldCollection(
  owner: string,
  fileContent: string,
  property: string,
  visited: Set<string>
): ToolInfo['params'] {
  const expression = extractPropertyExpression(owner, property)
  if (!expression) return []
  let objectContent: string | null = null

  if (expression.startsWith('{')) objectContent = expression
  else if (/^[A-Za-z_$][\w$]*$/.test(expression) && !visited.has(expression)) {
    visited.add(expression)
    objectContent = extractConstObject(fileContent, expression)
  }
  if (!objectContent) return []

  const fields: ToolInfo['params'] = []
  for (const entry of extractObjectEntries(objectContent)) {
    let value = entry.value
    if (/^[A-Za-z_$][\w$]*$/.test(value) && !visited.has(value)) {
      visited.add(value)
      value = extractConstObject(fileContent, value) || ''
    }
    if (!value.startsWith('{')) continue
    const type = extractStringProperty(value, 'type')
    if (!type) continue
    fields.push({
      name: entry.key,
      type,
      required: /\brequired\s*:\s*true\b/.test(value),
      description: extractStringProperty(value, 'description') || 'No description',
    })
  }
  return fields
}

function extractConstObject(content: string, identifier: string): string | null {
  const match = new RegExp(
    `(?:export\\s+)?const\\s+${escapeRegExp(identifier)}(?:\\s*:[^=]+)?\\s*=\\s*\\{`
  ).exec(content)
  if (!match) return null
  const openBrace = match.index + match[0].lastIndexOf('{')
  const body = extractBracedContent(content, openBrace - 1)
  return body ? `{${body}}` : null
}

function extractObjectEntries(objectContent: string): Array<{ key: string; value: string }> {
  const body = objectContent.slice(1, -1)
  const entries: Array<{ key: string; value: string }> = []
  let index = 0
  while (index < body.length) {
    index = skipSpaceAndCommas(body, index)
    const keyMatch = body.slice(index).match(/^(?:([A-Za-z_$][\w$]*)|['"]([^'"]+)['"])\s*:/)
    if (!keyMatch) break
    const key = keyMatch[1] || keyMatch[2]
    index += keyMatch[0].length
    const end = findExpressionEnd(body, index)
    entries.push({ key, value: body.slice(index, end).trim() })
    index = end + 1
  }
  return entries
}

function extractPropertyExpression(objectContent: string, property: string): string | null {
  return extractObjectEntries(objectContent).find((entry) => entry.key === property)?.value || null
}

function findExpressionEnd(text: string, start: number): number {
  let braces = 0
  let brackets = 0
  let parens = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '{') braces++
    else if (char === '}') braces--
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    else if (char === '(') parens++
    else if (char === ')') parens--
    else if (char === ',' && braces === 0 && brackets === 0 && parens === 0) return index
  }
  return text.length
}

function extractStringProperty(content: string, property: string): string | null {
  const expression = extractPropertyExpression(content, property)
  return expression?.match(/^['"`]([\s\S]*?)['"`](?:\s+as\s+const)?$/)?.[1] || null
}

function skipSpaceAndCommas(text: string, index: number): number {
  while (index < text.length && /[\s,]/.test(text[index])) index++
  return index
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
