import { type NextRequest, NextResponse } from 'next/server'
import {
  buildMcpInstallScript,
  MCP_SETUP_AGENTS,
  type McpInstallScriptOptions,
} from '../../../lib/mcp/install-script'
import { buildRobinhoodConnectScript } from '../../../lib/oauth/robinhood-connect-script'

export const dynamic = 'force-dynamic'

const SETUP_TARGETS = new Set<string>([...MCP_SETUP_AGENTS, 'all'])
type ConnectScriptFormat = 'sh' | 'powershell'

function parseMcpInstallOptions(command: string[]): McpInstallScriptOptions | null {
  if (command.length === 1) return { command: 'setup' }
  if (command.length === 2 && command[1] === 'login') return { command: 'login' }
  if (command[1] !== 'setup') return null
  if (command.length === 2) return { command: 'setup' }

  const target = command[2]
  return command.length === 3 && !!target && SETUP_TARGETS.has(target)
    ? { command: 'setup', target: target as McpInstallScriptOptions['target'] }
    : null
}

function resolveScriptFormat(request: NextRequest): ConnectScriptFormat {
  const userAgent = request.headers.get('user-agent') ?? ''
  return /\b(?:PowerShell|WindowsPowerShell|pwsh)\b/i.test(userAgent) ? 'powershell' : 'sh'
}

function createScriptResponse(script: string, format: ConnectScriptFormat) {
  return new NextResponse(script, {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ command?: string[] }> }
) {
  const command = (await params).command
  const format = resolveScriptFormat(request)
  if (command?.length === 1 && command[0] === 'robinhood') {
    return createScriptResponse(buildRobinhoodConnectScript(request.nextUrl.origin, format), format)
  }

  const options = command?.[0] === 'mcp' ? parseMcpInstallOptions(command) : null
  if (!options) {
    return new NextResponse('Unknown connection helper\n', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  return createScriptResponse(
    buildMcpInstallScript(request.nextUrl.origin, { ...options, format }),
    format
  )
}
