import { type NextRequest, NextResponse } from 'next/server'
import {
  buildMcpInstallScript,
  type McpInstallScriptFormat,
  type McpInstallScriptOptions,
} from '../../../lib/mcp/install-script'
import { getBaseUrl } from '../../../lib/urls/utils'

export const dynamic = 'force-dynamic'

const SETUP_TARGETS = new Set(['codex', 'cursor', 'claude', 'opencode', 'all'])

function parseInstallOptions(command: string[] | undefined): McpInstallScriptOptions | null {
  if (!command || command.length === 0) {
    return { command: 'setup' }
  }

  if (command.length === 1 && command[0] === 'login') {
    return { command: 'login' }
  }

  if (command[0] === 'setup') {
    if (command.length === 1) {
      return { command: 'setup' }
    }

    const target = command[1]
    if (command.length === 2 && SETUP_TARGETS.has(target)) {
      return {
        command: 'setup',
        target: target as McpInstallScriptOptions['target'],
      }
    }
  }

  return null
}

function resolveScriptFormat(request: NextRequest): McpInstallScriptFormat {
  const userAgent = request.headers.get('user-agent') ?? ''
  return /\b(?:PowerShell|WindowsPowerShell|pwsh)\b/i.test(userAgent) ? 'powershell' : 'sh'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ command?: string[] }> }
) {
  const options = parseInstallOptions((await params).command)
  if (!options) {
    return new NextResponse('Unknown MCP installer command\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  const format = resolveScriptFormat(request)

  return new NextResponse(buildMcpInstallScript(getBaseUrl(), { ...options, format }), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type':
        format === 'powershell'
          ? 'text/x-powershell; charset=utf-8'
          : 'text/x-shellscript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
