import { MCP_LOCAL_CONFIG_WRITER_SCRIPT } from './local-config-writer-script'
import { MCP_TERMINAL_UI_SCRIPT } from './terminal-ui-script'

type McpInstallCommand = 'setup' | 'login'
export type McpInstallTarget =
  | 'claude'
  | 'cursor'
  | 'opencode'
  | 'codex'
  | 'antigravity'
  | 'gemini'
  | 'all'
export type McpInstallScriptFormat = 'sh' | 'powershell'

export interface McpInstallScriptOptions {
  command: McpInstallCommand
  target?: McpInstallTarget
  format?: McpInstallScriptFormat
}

/** Selection order mirrors the Context7 CLI agent registry. */
export const MCP_SETUP_AGENTS = [
  'claude',
  'cursor',
  'opencode',
  'codex',
  'antigravity',
  'gemini',
] as const

function getInitialTargets(target: McpInstallTarget | undefined) {
  if (!target) {
    return ''
  }

  return target === 'all' ? MCP_SETUP_AGENTS.join(' ') : target
}

function getInitialPowerShellTargets(target: McpInstallTarget | undefined) {
  if (!target) {
    return '@()'
  }

  const targets = target === 'all' ? [...MCP_SETUP_AGENTS] : [target]
  return `@(${targets.map((item) => `'${item}'`).join(', ')})`
}

const MCP_INSTALLER_MAIN_SCRIPT = String.raw`const { spawnSync } = require('child_process')

const baseUrl = process.argv[2].replace(/\/+$/, '')
const command = process.argv[3]
const targets = process.argv[4] ? process.argv[4].split(/\s+/).filter(Boolean) : []
const mcpUrl = baseUrl + '/api/copilot/mcp'
const configWriterScript = ${JSON.stringify(MCP_LOCAL_CONFIG_WRITER_SCRIPT)}

const AGENT_NAMES = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  codex: 'Codex',
  antigravity: 'Antigravity',
  gemini: 'Gemini CLI',
}
const AGENT_ORDER = ['claude', 'cursor', 'opencode', 'codex', 'antigravity', 'gemini']
const AUTH_MODE_LABEL = 'API Key'

function fail(message) {
  console.error(pc.red(symbols.cross + ' ') + 'tradinggoose-mcp: ' + message)
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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    throw new Error(url + ' failed with HTTP ' + response.status)
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
    throw new Error((result.stderr || 'Failed to run the MCP config writer.').trim())
  }

  return JSON.parse(result.stdout.trim())
}

async function chooseTargets() {
  if (targets.length > 0) {
    return targets
  }

  if (!process.stdin.isTTY) {
    fail('setup requires an interactive terminal or a target URL such as /mcp/setup/codex.')
  }

  log.blank()
  return checkbox({
    message: 'Which agents do you want to set up?',
    choices: AGENT_ORDER.map((name) => ({ name: AGENT_NAMES[name], value: name })),
  })
}

async function authenticate() {
  const startSpinner = spinner('Preparing login...').start()

  let startJson
  try {
    startJson = await postJson(baseUrl + '/api/auth/mcp/start')
  } catch (error) {
    startSpinner.fail(pc.red('Login failed'))
    fail(error instanceof Error ? error.message : String(error))
  }

  const code = String(startJson?.code || '')
  const verificationKey = String(startJson?.verificationKey || '')
  const authorizeUrl = String(startJson?.authorizeUrl || '')
  const intervalSeconds = Math.max(1, Number(startJson?.intervalSeconds) || 2)

  if (!code) {
    startSpinner.fail(pc.red('Login failed'))
    fail('Studio did not return a login code')
  }
  if (!verificationKey) {
    startSpinner.fail(pc.red('Login failed'))
    fail('Studio did not return a login verification key')
  }
  if (!authorizeUrl) {
    startSpinner.fail(pc.red('Login failed'))
    fail('Studio did not return an authorization URL')
  }

  startSpinner.stop()

  log.blank()
  log.plain('  ' + pc.dim('Open this link to approve MCP access:'))
  log.plain('  ' + pc.cyan(link(authorizeUrl, authorizeUrl)))
  log.blank()

  const waitingSpinner = spinner('Waiting for authorization...').start()
  const deadline = Date.now() + 600000

  while (Date.now() < deadline) {
    let pollJson
    try {
      pollJson = await postJson(baseUrl + '/api/auth/mcp/poll', { code, verificationKey })
    } catch (error) {
      waitingSpinner.fail(pc.red('Login failed'))
      fail(error instanceof Error ? error.message : String(error))
    }

    const status = String(pollJson?.status || 'pending')

    if (status === 'approved') {
      const token = String(pollJson?.apiKey || '')
      if (!token) {
        waitingSpinner.fail(pc.red('Login failed'))
        fail('Studio approved login without returning a token')
      }
      waitingSpinner.succeed(pc.brand('Authorized'))
      return { code, verificationKey, token }
    }

    if (status === 'expired') {
      waitingSpinner.fail(pc.red('Login expired. Run the command again.'))
      process.exit(1)
    }

    if (status !== 'pending') {
      waitingSpinner.fail(pc.red('Unexpected login status: ' + status))
      process.exit(1)
    }

    await sleep(intervalSeconds * 1000)
  }

  waitingSpinner.fail(pc.red('Timed out waiting for browser approval'))
  process.exit(1)
}

async function acknowledge(login) {
  const ackJson = await postJson(baseUrl + '/api/auth/mcp/poll', {
    code: login.code,
    verificationKey: login.verificationKey,
    ackApiKey: login.token,
  })
  const status = String(ackJson?.status || '')
  if (status !== 'acknowledged') {
    fail('Studio did not activate the MCP token: ' + (status || 'unknown'))
  }
}

function configureTarget(target, login) {
  try {
    const written = runConfigWriter([target, mcpUrl, login.token])
    return {
      agent: AGENT_NAMES[target],
      path: written.path,
      status: (written.alreadyExists ? 'reconfigured' : 'configured') + ' with ' + AUTH_MODE_LABEL,
    }
  } catch (error) {
    return {
      agent: AGENT_NAMES[target],
      path: '',
      status: 'failed: ' + (error instanceof Error ? error.message : String(error)),
    }
  }
}

function renderResults(results) {
  log.blank()
  for (const result of results) {
    log.plain('  ' + pc.bold(result.agent))
    const failed = result.status.startsWith('failed:')
    const icon = failed ? pc.red(symbols.cross) : pc.brand('+')
    log.plain('    ' + icon + ' MCP server ' + (failed ? 'failed' : result.status))
    if (failed) {
      log.plain('      ' + pc.red(result.status.slice('failed: '.length)))
    } else {
      log.plain('      ' + pc.dim(result.path))
    }
  }
  log.blank()
}

async function main() {
  requireFetch()

  if (command === 'login') {
    const login = await authenticate()
    await acknowledge(login)

    log.blank()
    log.plain('  ' + pc.bold('MCP endpoint'))
    log.plain('    ' + pc.dim(mcpUrl))
    log.plain('  ' + pc.bold('MCP authorization header'))
    log.plain('    ' + pc.dim('Authorization: Bearer ' + login.token))
    log.blank()
    return
  }

  if (command === 'setup') {
    const selected = await chooseTargets()
    if (!selected || selected.length === 0) {
      log.warn('Setup cancelled')
      return
    }

    for (const target of selected) {
      if (!AGENT_NAMES[target]) {
        fail('Unsupported setup target: ' + target)
      }
    }

    const login = await authenticate()
    await acknowledge(login)

    log.blank()
    const setupSpinner = spinner('Setting up TradingGoose...').start()
    const results = []
    for (const target of selected) {
      setupSpinner.setText('Setting up ' + AGENT_NAMES[target] + '...')
      results.push(configureTarget(target, login))
    }
    setupSpinner.succeed('TradingGoose setup complete')

    renderResults(results)
    return
  }

  fail('Unknown command: ' + command)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
`

const MCP_LOCAL_INSTALLER_SCRIPT = `${MCP_TERMINAL_UI_SCRIPT}\n${MCP_INSTALLER_MAIN_SCRIPT}`

export function buildMcpInstallScript(baseUrl: string, options: McpInstallScriptOptions) {
  return options.format === 'powershell'
    ? buildPowerShellInstallScript(baseUrl, options)
    : buildShellInstallScript(baseUrl, options)
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function powerShellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function buildShellInstallScript(baseUrl: string, options: McpInstallScriptOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const initialTargets = getInitialTargets(options.target)

  return `#!/bin/sh
set -eu

BASE_URL=${shellSingleQuote(normalizedBaseUrl)}
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
  login   Print the MCP endpoint and authorization header, authenticating when needed.
  setup   Write MCP config, authenticating when needed.

Targets:
  claude, cursor, opencode, codex, antigravity, gemini, all

Options:
  -h, --help        Show this help.
USAGE
}

fail() {
  echo "tradinggoose-mcp: $*" >&2
  exit 1
}

# The installer is written to a temp file rather than piped to "node -" so that
# node's stdin stays free for the interactive target picker. Under "curl | sh"
# the shell's own stdin is the curl pipe, so we hand node the controlling
# terminal explicitly.
run_installer() {
  command -v node >/dev/null 2>&1 || fail "node is required to configure MCP auth and write config."

  tmp_dir=$(mktemp -d 2>/dev/null || mktemp -d -t tradinggoose-mcp) || fail "unable to create a temporary directory."
  trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

  cat >"$tmp_dir/installer.js" <<'NODE'
${MCP_LOCAL_INSTALLER_SCRIPT}
NODE

  # A -r test on /dev/tty only checks permission bits and still passes when the
  # process has no controlling terminal, so probe by actually opening it. The
  # probe runs in a subshell because ":" is a special builtin, and a redirection
  # failure on one of those aborts the whole script under POSIX sh.
  if (: </dev/tty) 2>/dev/null; then
    node "$tmp_dir/installer.js" "$BASE_URL" "$COMMAND" "$TARGETS" </dev/tty
  else
    node "$tmp_dir/installer.js" "$BASE_URL" "$COMMAND" "$TARGETS"
  fi
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
  setup|login)
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
}

function buildPowerShellInstallScript(baseUrl: string, options: McpInstallScriptOptions) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const initialTargets = getInitialPowerShellTargets(options.target)

  return `$ErrorActionPreference = 'Stop'

# Box-drawing and spinner glyphs need a UTF-8 console on legacy Windows hosts.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$BaseUrl = ${powerShellSingleQuote(normalizedBaseUrl)}
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
  login   Print the MCP endpoint and authorization header, authenticating when needed.
  setup   Write MCP config, authenticating when needed.

Targets:
  claude, cursor, opencode, codex, antigravity, gemini, all

Options:
  -h, --help        Show this help.
'@ | Write-Output
}

function Fail([string] $Message) {
  Write-Error "tradinggoose-mcp: $Message"
  exit 1
}

# Written to a temp file rather than piped to "node -" so node's stdin stays
# attached to the console for the interactive target picker.
function Run-Installer {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'node is required to configure MCP auth and write config.'
  }

  $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('tradinggoose-mcp-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

  try {
    $ScriptPath = Join-Path $TempDir 'installer.js'
    $NodeScript = @'
${MCP_LOCAL_INSTALLER_SCRIPT}
'@
    Set-Content -LiteralPath $ScriptPath -Value $NodeScript -Encoding UTF8
    & node $ScriptPath $BaseUrl $Command ($Targets -join ' ')
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
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
