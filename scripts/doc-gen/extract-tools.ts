import fs from 'fs'
import path from 'path'
import type { ToolInfo } from './types'
import { extractBracedContent } from './utils'

/**
 * Resolve and extract tool info from the tools directory.
 */
export async function getToolInfo(
  toolName: string,
  toolsBasePath: string
): Promise<ToolInfo | null> {
  try {
    const parts = toolName.split('_')
    let toolPrefix = ''
    let toolSuffix = ''

    // Find the right tool directory by trying progressively shorter prefixes
    for (let i = parts.length - 1; i >= 1; i--) {
      const possiblePrefix = parts.slice(0, i).join('_')
      const possibleSuffix = parts.slice(i).join('_')
      const toolDirPath = path.join(toolsBasePath, possiblePrefix)
      if (fs.existsSync(toolDirPath) && fs.statSync(toolDirPath).isDirectory()) {
        toolPrefix = possiblePrefix
        toolSuffix = possibleSuffix
        break
      }
    }

    if (!toolPrefix) {
      toolPrefix = parts[0]
      toolSuffix = parts.slice(1).join('_')
    }

    // Try multiple file naming conventions
    const camelSuffix = toolSuffix
      .split('_')
      .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join('')

    const candidates = [
      path.join(toolsBasePath, toolPrefix, `${toolSuffix}.ts`),
      path.join(toolsBasePath, toolPrefix, `${camelSuffix}.ts`),
      path.join(toolsBasePath, toolPrefix, 'index.ts'),
    ]

    let fileContent = ''
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        fileContent = fs.readFileSync(candidate, 'utf-8')
        break
      }
    }

    if (!fileContent) return null

    return extractToolInfo(toolName, fileContent)
  } catch (error) {
    console.error(`Error getting info for tool ${toolName}:`, error)
    return null
  }
}

function extractToolInfo(toolName: string, fileContent: string): ToolInfo | null {
  try {
    const descMatch = fileContent.match(/description\s*:\s*['"](.*?)['"]/)
    const description = descMatch ? descMatch[1] : 'No description available'

    // Extract params
    const params: ToolInfo['params'] = []
    const toolConfigRegex =
      /params\s*:\s*{([\s\S]*?)},?\s*(?:outputs|oauth|request|directExecution|postProcess|transformResponse)/
    const toolConfigMatch = fileContent.match(toolConfigRegex)

    if (toolConfigMatch) {
      const paramsContent = toolConfigMatch[1]
      const paramRegex = /(\w+)\s*:\s*{/g
      let paramMatch

      while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
        const paramName = paramMatch[1]
        if (['accessToken', 'params', 'tools'].includes(paramName)) continue

        const startPos = paramMatch.index + paramMatch[0].length - 1
        let braceCount = 1
        let endPos = startPos + 1
        while (endPos < paramsContent.length && braceCount > 0) {
          if (paramsContent[endPos] === '{') braceCount++
          else if (paramsContent[endPos] === '}') braceCount--
          endPos++
        }

        if (braceCount === 0) {
          const paramBlock = paramsContent.substring(startPos + 1, endPos - 1).trim()
          const typeMatch = paramBlock.match(/type\s*:\s*['"]([^'"]+)['"]/)
          const requiredMatch = paramBlock.match(/required\s*:\s*(true|false)/)
          const descMatch =
            paramBlock.match(/description\s*:\s*'(.*?)'(?=\s*[,}])/s) ||
            paramBlock.match(/description\s*:\s*"(.*?)"(?=\s*[,}])/s) ||
            paramBlock.match(/description\s*:\s*`([^`]+)`/s)

          params.push({
            name: paramName,
            type: typeMatch ? typeMatch[1] : 'string',
            required: requiredMatch ? requiredMatch[1] === 'true' : false,
            description: descMatch ? descMatch[1] : 'No description',
          })
        }
      }
    }

    // Extract outputs
    let outputs: Record<string, any> = {}
    const outputsRegex =
      /outputs\s*:\s*{([\s\S]*?)}\s*,?\s*(?:oauth|params|request|directExecution|postProcess|transformResponse|$|\})/
    const outputsMatch = fileContent.match(outputsRegex)

    if (outputsMatch) {
      const outputsContent = outputsMatch[1]
      const fieldRegex = /(\w+)\s*:\s*{/g
      let match

      while ((match = fieldRegex.exec(outputsContent)) !== null) {
        const fieldName = match[1]
        const fieldContent = extractBracedContent(outputsContent, match.index + match[0].length - 2)
        if (!fieldContent) continue

        const typeMatch = fieldContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const descMatch = fieldContent.match(/description\s*:\s*['"`]([^'"`\n]+)['"`]/)
        if (typeMatch) {
          outputs[fieldName] = {
            type: typeMatch[1],
            description: descMatch ? descMatch[1] : `${fieldName} output`,
          }
        }
      }
    }

    return { description, params, outputs }
  } catch (error) {
    console.error(`Error extracting tool info for ${toolName}:`, error)
    return null
  }
}
