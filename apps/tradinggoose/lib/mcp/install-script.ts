import { MCP_LOCAL_CONFIG_WRITER_SCRIPT } from './local-config-writer-script'

type McpInstallCommand = 'setup' | 'login'
type McpInstallTarget = 'codex' | 'cursor' | 'claude' | 'opencode' | 'all'
export type McpInstallScriptFormat = 'sh' | 'powershell'

export interface McpInstallScriptOptions {
  command: McpInstallCommand
  target?: McpInstallTarget
  format?: McpInstallScriptFormat
}

function getInitialTargets(target: McpInstallTarget | undefined) {
  if (!target) {
    return ''
  }

  return target === 'all' ? 'codex cursor claude opencode' : target
}

function getInitialPowerShellTargets(target: McpInstallTarget | undefined) {
  if (!target) {
    return '@()'
  }

  const targets = target === 'all' ? ['codex', 'cursor', 'claude', 'opencode'] : [target]
  return `@(${targets.map((item) => `'${item}'`).join(', ')})`
}

const MCP_LOCAL_INSTALLER_SCRIPT = String.raw`const { spawnSync } = require('child_process')

const baseUrl = process.argv[2].replace(/\/+$/, '')
const command = process.argv[3]
const targets = process.argv[4] ? process.argv[4].split(/\s+/).filter(Boolean) : []
const mcpUrl = baseUrl + '/api/copilot/mcp'
const configWriterScript = ${JSON.stringify(MCP_LOCAL_CONFIG_WRITER_SCRIPT)}

function fail(message) {
  console.error('tradinggoose-mcp: ' + message)
  process.exit(1)
}

function requireFetch() {
  if (typeof fetch !== 'function') {
    fail('node 18 or newer is required to configure MCP auth.')
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    fail(url + ' failed with HTTP ' + response.status)
  }

  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : null
}

function runConfigWriter(args) {
  const result = spawnSync(process.execPath, ['-', ...args], {
    input: configWriterScript,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    fail((result.stderr || 'Failed to run the MCP config writer.').trim())
  }

  return result.stdout.trim()
}

function readExistingTokens() {
  return runConfigWriter(['read-tokens']).split(/\r?\n/).filter(Boolean)
}

async function isTokenValid(token) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'auth-check', method: 'ping' }),
  })

  return response.ok
}

async function readValidExistingToken() {
  const tokens = readExistingTokens()
  for (const token of tokens) {
    if (await isTokenValid(token)) {
      return token
    }
  }
  return null
}

async function resolveAuthToken() {
  const existingToken = await readValidExistingToken()
  if (existingToken) {
    return existingToken
  }

  return authenticate()
}

async function authenticate() {
  const startJson = await postJson(baseUrl + '/api/auth/mcp/start')
  const code = String(startJson?.code || '')
  const verificationKey = String(startJson?.verificationKey || '')
  const authorizeUrl = String(startJson?.authorizeUrl || '')
  const intervalSeconds = Math.max(1, Number(startJson?.intervalSeconds) || 2)

  if (!code) {
    fail('Studio did not return a login code')
  }
  if (!verificationKey) {
    fail('Studio did not return a login verification key')
  }
  if (!authorizeUrl) {
    fail('Studio did not return an authorization URL')
  }

  console.log('Open this URL in your browser to approve a personal API key:')
  console.log(authorizeUrl)
  console.log('')

  const deadline = Date.now() + 600000
  while (Date.now() < deadline) {
    const pollJson = await postJson(baseUrl + '/api/auth/mcp/poll', { code, verificationKey })
    const status = String(pollJson?.status || 'pending')

    if (status === 'approved') {
      const token = String(pollJson?.apiKey || '')
      if (!token) {
        fail('Studio approved login without returning a token')
      }
      return token
    }

    if (status === 'expired') {
      fail('Login expired. Run the command again.')
    }

    if (status !== 'pending') {
      fail('Unexpected login status: ' + status)
    }

    await sleep(intervalSeconds * 1000)
  }

  fail('Timed out waiting for browser approval')
}

async function main() {
  requireFetch()

  if (command === 'login') {
    const token = await resolveAuthToken()
    console.log('MCP endpoint:')
    console.log(mcpUrl)
    console.log('')
    console.log('Bearer token:')
    console.log(token)
    console.log('')
    console.log('Use this MCP auth header:')
    console.log('Authorization: Bearer ' + token)
    return
  }

  if (command === 'setup') {
    if (targets.length === 0) {
      fail('setup requires a selected target')
    }

    const token = await resolveAuthToken()
    console.log('Using MCP endpoint: ' + mcpUrl)
    for (const target of targets) {
      const configPath = runConfigWriter([target, mcpUrl, token])
      console.log('Configured ' + target + ': ' + configPath)
    }
    return
  }

  fail('Unknown command: ' + command)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
`

export function buildMcpInstallScript(baseUrl: string, options: McpInstallScriptOptions) {
  return options.format === 'powershell'
    ? buildPowerShellInstallScript(baseUrl, options)
    : buildShellInstallScript(baseUrl, options)
}

function buildShellInstallScript(baseUrl: string, options: McpInstallScriptOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const initialTargets = getInitialTargets(options.target)
  const script = String.raw`#!/bin/sh
set -eu

BASE_URL="${normalizedBaseUrl}"
COMMAND="${options.command}"
TARGETS="${initialTargets}"

usage() {
  cat <<'USAGE'
TradingGoose MCP setup

Usage:
  curl -fsSL <studio-url>/mcp/setup | sh
  curl -fsSL <studio-url>/mcp/setup/codex | sh
  curl -fsSL <studio-url>/mcp/login | sh

PowerShell:
  irm <studio-url>/mcp/setup | iex
  irm <studio-url>/mcp/setup/codex | iex
  irm <studio-url>/mcp/login | iex

Commands:
  login   Print a valid local personal API bearer token, authenticating when needed.
  setup   Write MCP config, authenticating when needed.

Options:
  -h, --help        Show this help.
USAGE
}

fail() {
  echo "tradinggoose-mcp: $*" >&2
  exit 1
}

add_target() {
  case " $TARGETS " in
    *" $1 "*) ;;
    *) TARGETS="\${TARGETS}\${TARGETS:+ }$1" ;;
  esac
}

choose_targets() {
  if [ -n "$TARGETS" ]; then
    return 0
  fi

  if [ ! -r /dev/tty ]; then
    fail "setup requires an interactive terminal or a target URL such as /mcp/setup/codex."
  fi

  {
    echo "Choose local MCP target:"
    echo "  1) Codex"
    echo "  2) Cursor"
    echo "  3) Claude Code"
    echo "  4) OpenCode"
    echo "  5) All"
    printf "Target [1-5]: "
  } >/dev/tty

  read -r choice </dev/tty
  case "$choice" in
    1) add_target codex ;;
    2) add_target cursor ;;
    3) add_target claude ;;
    4) add_target opencode ;;
    5)
      add_target codex
      add_target cursor
      add_target claude
      add_target opencode
      ;;
    *) fail "Invalid setup target: $choice" ;;
  esac
}

run_installer() {
  command -v node >/dev/null 2>&1 || fail "node is required to configure MCP auth and write config."
  node - "$BASE_URL" "$COMMAND" "$TARGETS" <<'NODE'
${MCP_LOCAL_INSTALLER_SCRIPT}
NODE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

case "$COMMAND" in
  setup)
    choose_targets
    run_installer
    ;;
  login)
    run_installer
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    fail "Unknown command: $COMMAND"
    ;;
esac
`
  return script.replaceAll('\\${', '${')
}

function buildPowerShellInstallScript(baseUrl: string, options: McpInstallScriptOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const initialTargets = getInitialPowerShellTargets(options.target)

  return String.raw`$ErrorActionPreference = 'Stop'

$BaseUrl = '${normalizedBaseUrl}'
$Command = '${options.command}'
$Targets = ${initialTargets}

function Show-Usage {
  @'
TradingGoose MCP setup

Usage:
  irm <studio-url>/mcp/setup | iex
  irm <studio-url>/mcp/setup/codex | iex
  irm <studio-url>/mcp/login | iex

POSIX shell:
  curl -fsSL <studio-url>/mcp/setup | sh
  curl -fsSL <studio-url>/mcp/setup/codex | sh
  curl -fsSL <studio-url>/mcp/login | sh

Commands:
  login   Print a valid local personal API bearer token, authenticating when needed.
  setup   Write MCP config, authenticating when needed.

Options:
  -h, --help        Show this help.
'@ | Write-Output
}

function Fail([string] $Message) {
  Write-Error "tradinggoose-mcp: $Message"
  exit 1
}

function Add-Target([string] $Target) {
  if ($script:Targets -notcontains $Target) {
    $script:Targets += $Target
  }
}

function Choose-Targets {
  if ($script:Targets.Count -gt 0) {
    return
  }

  Write-Host 'Choose local MCP target:'
  Write-Host '  1) Codex'
  Write-Host '  2) Cursor'
  Write-Host '  3) Claude Code'
  Write-Host '  4) OpenCode'
  Write-Host '  5) All'
  $Choice = Read-Host 'Target [1-5]'

  switch ($Choice) {
    '1' { Add-Target 'codex' }
    '2' { Add-Target 'cursor' }
    '3' { Add-Target 'claude' }
    '4' { Add-Target 'opencode' }
    '5' {
      Add-Target 'codex'
      Add-Target 'cursor'
      Add-Target 'claude'
      Add-Target 'opencode'
    }
    default { Fail "Invalid setup target: $Choice" }
  }
}

function Run-Installer {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'node is required to configure MCP auth and write config.'
  }

  $NodeScript = @'
${MCP_LOCAL_INSTALLER_SCRIPT}
'@
  $NodeScript | & node - $BaseUrl $Command ($Targets -join ' ')
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

for ($Index = 0; $Index -lt $args.Count; $Index++) {
  switch ($args[$Index]) {
    '-h' {
      Show-Usage
      exit 0
    }
    '--help' {
      Show-Usage
      exit 0
    }
    default {
      Fail "Unknown option: $($args[$Index])"
    }
  }
}

switch ($Command) {
  'setup' {
    Choose-Targets
    Run-Installer
  }
  'login' {
    Run-Installer
  }
  default {
    Fail "Unknown command: $Command"
  }
}
`
}
