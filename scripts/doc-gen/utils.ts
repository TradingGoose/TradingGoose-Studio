import fs from 'fs'

// ── String extraction ─────────────────────────────────────────────

export function extractStringProperty(content: string, propName: string): string | null {
  const singleQuoteMatch = content.match(new RegExp(`${propName}\\s*:\\s*'(.*?)'`, 'm'))
  if (singleQuoteMatch) return singleQuoteMatch[1]

  const doubleQuoteMatch = content.match(new RegExp(`${propName}\\s*:\\s*"(.*?)"`, 'm'))
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  const templateMatch = content.match(new RegExp(`${propName}\\s*:\\s*\`([^\`]+)\``, 's'))
  if (templateMatch) {
    let templateContent = templateMatch[1]
    templateContent = templateContent.replace(
      /\$\{[^}]*shouldEnableURLInput[^}]*\?[^:]*:[^}]*\}/g,
      'Upload files directly. '
    )
    templateContent = templateContent.replace(/\$\{[^}]*shouldEnableURLInput[^}]*\}/g, 'false')
    templateContent = templateContent.replace(/\$\{[^}]+\}/g, '')
    templateContent = templateContent.replace(/\s+/g, ' ').trim()
    return templateContent
  }

  return null
}

// ── Markdown escaping ─────────────────────────────────────────────

export function escapeMdx(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Brace-matching helper ─────────────────────────────────────────

export function extractBracedContent(content: string, startPos: number): string | null {
  const openBracePos = content.indexOf('{', startPos)
  if (openBracePos === -1) return null

  let braceCount = 1
  let pos = openBracePos + 1
  while (pos < content.length && braceCount > 0) {
    if (content[pos] === '{') braceCount++
    else if (content[pos] === '}') braceCount--
    pos++
  }

  if (braceCount !== 0) return null
  return content.substring(openBracePos + 1, pos - 1).trim()
}

// ── Manual content preservation ───────────────────────────────────

export function extractManualContent(existingContent: string): Record<string, string> {
  const manualSections: Record<string, string> = {}
  const regex =
    /\{\/\*\s*MANUAL-CONTENT-START:(\w+)\s*\*\/\}([\s\S]*?)\{\/\*\s*MANUAL-CONTENT-END\s*\*\/\}/g

  let match
  while ((match = regex.exec(existingContent)) !== null) {
    manualSections[match[1]] = match[2].trim()
  }
  return manualSections
}

export function mergeManualContent(
  generatedMarkdown: string,
  manualSections: Record<string, string>
): string {
  if (Object.keys(manualSections).length === 0) return generatedMarkdown

  let result = generatedMarkdown

  const insertionPoints: Record<string, RegExp> = {
    intro: /<BlockInfoCard[\s\S]*?\/>/,
    usage: /## Usage Instructions/,
    outputs: /## Outputs/,
    notes: /## Notes/,
  }

  for (const [section, content] of Object.entries(manualSections)) {
    const regex = insertionPoints[section]
    if (!regex) continue

    const match = result.match(regex)
    if (match?.index !== undefined) {
      const pos = match.index + match[0].length
      result = `${result.slice(0, pos)}\n\n{/* MANUAL-CONTENT-START:${section} */}\n${content}\n{/* MANUAL-CONTENT-END */}\n${result.slice(pos)}`
    }
  }

  return result
}

// ── Meta.json updater ─────────────────────────────────────────────

export function updateMetaJson(docsDir: string) {
  const metaJsonPath = `${docsDir}/meta.json`
  const pages = fs
    .readdirSync(docsDir)
    .filter((f: string) => f.endsWith('.mdx'))
    .map((f: string) => f.replace('.mdx', ''))

  const items = [
    ...(pages.includes('index') ? ['index'] : []),
    ...pages.filter((f: string) => f !== 'index').sort(),
  ]

  fs.writeFileSync(metaJsonPath, JSON.stringify({ pages: items }, null, 2))
}
