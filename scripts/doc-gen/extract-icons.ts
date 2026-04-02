import fs from 'fs'

/**
 * Extract SVG icons from icon component files.
 * Reads exported function/const components that return <svg> elements.
 */
export function extractIcons(iconPaths: string[]): Record<string, string> {
  const icons: Record<string, string> = {}

  for (const iconPath of iconPaths) {
    if (!fs.existsSync(iconPath)) continue
    extractFromFile(fs.readFileSync(iconPath, 'utf-8'), icons)
  }

  console.log(`  Extracted ${Object.keys(icons).length} icons from ${iconPaths.length} files`)
  return icons
}

function cleanSvg(raw: string): string | null {

  return raw
    .replace(/{\.\.\.props}/g, '')
    .replace(/{\.\.\.(props|rest)}/g, '')
    .replace(/width=["'][^"']*["']/g, '')
    .replace(/height=["'][^"']*["']/g, '')
    .replace(/<svg/, '<svg className="block-icon"')
}

function extractFromFile(content: string, icons: Record<string, string>) {
  // export function FooIcon(props) { return (<svg ...>...</svg>) }
  const fnRegex =
    /export\s+function\s+(\w+Icon)\s*\([^)]*\)\s*{[\s\S]*?return\s*\(\s*<svg[\s\S]*?<\/svg>\s*\)/g
  for (const match of content.matchAll(fnRegex)) {
    const name = match[1]
    const svgMatch = match[0].match(/<svg[\s\S]*?<\/svg>/)
    if (name && svgMatch) {
      const cleaned = cleanSvg(svgMatch[0])
      if (cleaned) icons[name] = cleaned
    }
  }

  // export const FooIcon = (props) => (<svg ...>...</svg>)
  const arrowRegex =
    /export\s+const\s+(\w+Icon)\s*=\s*\([^)]*\)\s*=>\s*(\(?\s*<svg[\s\S]*?<\/svg>\s*\)?)/g
  for (const match of content.matchAll(arrowRegex)) {
    const name = match[1]
    const svgMatch = match[2].match(/<svg[\s\S]*?<\/svg>/)
    if (name && svgMatch) {
      const cleaned = cleanSvg(svgMatch[0])
      if (cleaned) icons[name] = cleaned
    }
  }
}
