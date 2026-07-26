/**
 * @vitest-environment node
 */

import { spawnSync } from 'child_process'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMcpInstallScript } from '../../../lib/mcp/install-script'

async function callInstaller(
  pathname: string,
  command?: string[],
  headers?: HeadersInit,
  origin = 'https://studio.example.test'
) {
  const { GET } = await import('./route')
  return GET(new NextRequest(`${origin}${pathname}`, { headers }), {
    params: Promise.resolve({ command }),
  })
}

function expectShellScript(script: string) {
  const shellCheck = spawnSync('sh', ['-n', '-c', script], {
    encoding: 'utf8',
    timeout: 5000,
  })
  expect(shellCheck.status).toBe(0)
  expect(shellCheck.stderr).toBe('')
}

describe('MCP install route', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studio.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('serves the default setup script at /mcp', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    expectShellScript(script)
    expect(response.headers.get('Content-Type')).toBe('text/x-shellscript; charset=utf-8')
    expect(script).toContain("BASE_URL='https://studio.example.test'")
    expect(script).toContain('COMMAND="setup"')
    expect(script).toContain('TARGETS=""')
    expect(script).toContain('curl -fsSL <studio-url>/mcp/setup | sh')
    expect(script).toContain('curl -fsSL <studio-url>/mcp/setup/codex | sh')
    expect(script).toContain('curl -fsSL <studio-url>/mcp/login | sh')
    expect(script).toContain('irm <studio-url>/mcp/setup | iex')
    expect(script).toContain('irm <studio-url>/mcp/setup/codex | iex')
    expect(script).toContain('irm <studio-url>/mcp/login | iex')
    expect(script).toContain("baseUrl + '/api/auth/mcp/start'")
    expect(script).toContain("baseUrl + '/api/auth/mcp/poll'")
    expect(script).toContain('const verificationKey = String(startJson?.verificationKey ||')
    expect(script).toContain('return { code, verificationKey, token }')
    expect(script).toContain('async function acknowledge(login)')
    expect(script).toContain('ackApiKey: login.token')
    expect(script).not.toContain('confirmLogin')
    expect(script).not.toContain('confirm: true')
    expect(script).toContain("baseUrl + '/api/copilot/mcp'")
    expect(script).not.toContain("method: 'ping'")
    expect(script).not.toContain('async function isTokenValid(token)')
    expect(script).not.toContain('async function resolveAuthToken()')
    expect(script).toContain("Authorization: Bearer ' + login.token")
    expect(script).toContain('setup   Write MCP config, authenticating when needed.')
    expect(script).not.toContain('read-tokens')
    // The installer runs from a temp file, not `node -`, so node's stdin stays
    // attached to the terminal for the interactive target picker.
    expect(script).toContain('cat >"$tmp_dir/installer.js" <<\'NODE\'')
    expect(script).toContain(
      'node "$tmp_dir/installer.js" "$BASE_URL" "$COMMAND" "$TARGETS" </dev/tty'
    )
    expect(script).not.toContain('node - "$BASE_URL"')
    expect(script).toContain('runConfigWriter([target, mcpUrl, login.token])')
    expect(script).toContain("const mcpServerName = 'TradingGoose'")
    expect(script).toContain("'[mcp_servers.' + mcpServerName + '.http_headers]'")
    expect(script).not.toContain('TRADINGGOOSE_BEARER_TOKEN')
    expect(script).not.toContain('bearer_token_env_var')
    expect(script).not.toContain("spawnSync('setx'")
    expect(script).toContain("path.join(os.homedir(), '.codex', 'config.toml')")
    expect(script).toContain("path.join(os.homedir(), '.cursor', 'mcp.json')")
    expect(script).toContain("path.join(os.homedir(), '.claude.json')")
    expect(script).toContain("path.join(dir, 'opencode.json')")
    expect(script).toContain("path.join(os.homedir(), '.gemini', 'settings.json')")
    expect(script).toContain("path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')")
    expect(script).not.toContain('workspaceId')
    expect(script).not.toContain('entityId')

    const printedTokenIndex = script.indexOf("pc.dim('Authorization: Bearer ' + login.token)")
    const firstReturnTokenIndex = script.indexOf('return { code, verificationKey, token }')
    expect(printedTokenIndex).toBeGreaterThan(firstReturnTokenIndex)

    // Within the setup branch the token must be minted and acknowledged before
    // any config file is written.
    const setupIndex = script.indexOf("if (command === 'setup')")
    expect(setupIndex).toBeGreaterThan(-1)
    const chooseIndex = script.indexOf('await chooseTargets()', setupIndex)
    const authenticateIndex = script.indexOf('await authenticate()', setupIndex)
    const acknowledgeIndex = script.indexOf('await acknowledge(login)', setupIndex)
    const configWriteIndex = script.indexOf('configureTarget(target, login)', setupIndex)

    for (const index of [chooseIndex, authenticateIndex, acknowledgeIndex, configWriteIndex]) {
      expect(index).toBeGreaterThan(setupIndex)
    }
    expect(chooseIndex).toBeLessThan(authenticateIndex)
    expect(authenticateIndex).toBeLessThan(acknowledgeIndex)
    expect(acknowledgeIndex).toBeLessThan(configWriteIndex)
  })

  it('serves target-specific setup scripts from the URL path', async () => {
    const response = await callInstaller('/mcp/setup/codex', ['setup', 'codex'])
    const script = await response.text()

    expectShellScript(script)
    expect(script).toContain('COMMAND="setup"')
    expect(script).toContain('TARGETS="codex"')
  })

  it('uses configured and quoted installer base URLs', async () => {
    const response = await callInstaller(
      '/mcp',
      undefined,
      undefined,
      'https://request.example.test'
    )
    const script = await response.text()

    expect(script).toContain("BASE_URL='https://studio.example.test'")
    expect(script).not.toContain("BASE_URL='https://request.example.test'")

    const shellScript = buildMcpInstallScript(
      "https://studio.example.test/$(touch pwn)`bad`'quote",
      {
        command: 'login',
        format: 'sh',
      }
    )
    const powerShellScript = buildMcpInstallScript(
      "https://studio.example.test/$(bad)`bad`'quote",
      {
        command: 'login',
        format: 'powershell',
      }
    )

    expectShellScript(shellScript)
    expect(shellScript).toContain(
      "BASE_URL='https://studio.example.test/$(touch pwn)`bad`'\"'\"'quote'"
    )
    expect(powerShellScript).toContain(
      "$BaseUrl = 'https://studio.example.test/$(bad)`bad`''quote'"
    )
  })

  it('serves PowerShell scripts for PowerShell clients', async () => {
    const response = await callInstaller('/mcp/setup/codex', ['setup', 'codex'], {
      'user-agent': 'Mozilla/5.0 PowerShell/7.5',
    })
    const script = await response.text()

    expect(response.headers.get('Content-Type')).toBe('text/x-powershell; charset=utf-8')
    expect(script).toContain("$BaseUrl = 'https://studio.example.test'")
    expect(script).toContain("$Command = 'setup'")
    expect(script).toContain("$Targets = @('codex')")
    expect(script).toContain('irm <studio-url>/mcp/setup | iex')
    // Same temp-file execution as the POSIX path, so the console stays on stdin.
    expect(script).toContain(
      'Set-Content -LiteralPath $ScriptPath -Value $NodeScript -Encoding UTF8'
    )
    expect(script).toContain("& node $ScriptPath $BaseUrl $Command ($Targets -join ' ')")
    expect(script).not.toContain('| & node -')
    expect(script).toContain("baseUrl + '/api/auth/mcp/start'")
    expect(script).toContain('ackApiKey: login.token')
    expect(script).not.toContain("runConfigWriter(['read-tokens'])")
    expect(script).not.toContain("method: 'ping'")
    expect(script).toContain("const mcpServerName = 'TradingGoose'")
    expect(script).toContain("'[mcp_servers.' + mcpServerName + '.http_headers]'")
    expect(script).not.toContain('TRADINGGOOSE_BEARER_TOKEN')
    expect(script).not.toContain('bearer_token_env_var')
    expect(script).not.toContain("spawnSync('setx'")
    expect(script).not.toContain('#!/bin/sh')
  })

  it('serves login scripts from the URL path', async () => {
    const response = await callInstaller('/mcp/login', ['login'])
    const script = await response.text()

    expectShellScript(script)
    expect(script).toContain('COMMAND="login"')
    expect(script).toContain('TARGETS=""')
  })

  it.each(['claude', 'cursor', 'opencode', 'codex', 'antigravity', 'gemini'])(
    'serves a setup script for the %s target',
    async (target) => {
      const response = await callInstaller(`/mcp/setup/${target}`, ['setup', target])
      const script = await response.text()

      expectShellScript(script)
      expect(script).toContain(`TARGETS="${target}"`)
    }
  )

  it('expands the all target to every supported agent', async () => {
    const response = await callInstaller('/mcp/setup/all', ['setup', 'all'])
    const script = await response.text()

    expect(script).toContain('TARGETS="claude cursor opencode codex antigravity gemini"')
  })

  it('renders the interactive target picker in the installer, not the shell', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    // Target selection moved out of the shell into the node installer so it can
    // render the Context7-style checkbox instead of a numbered read prompt.
    expect(script).toContain("message: 'Which agents do you want to set up?'")
    expect(script).toContain('function checkbox(options)')
    expect(script).not.toContain('choose_targets')
    expect(script).not.toContain('Target [1-5]')
    expect(script).toContain(
      'AGENT_ORDER.map((name) => ({ name: AGENT_NAMES[name], value: name }))'
    )
  })

  it('uses the TradingGoose brand color rather than the Context7 green', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    expect(script).toContain("'38;2;255;204;0'")
    expect(script).toContain("'38;5;220'")
    expect(script).toContain('brand: paint(BRAND_OPEN')
    expect(script).not.toContain("green: paint('32'")
  })

  it('reports configured versus reconfigured per agent', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    expect(script).toContain(
      "(written.alreadyExists ? 'reconfigured' : 'configured') + ' with ' + AUTH_MODE_LABEL"
    )
    expect(script).toContain('JSON.stringify({ path: filePath, alreadyExists: alreadyExists })')
  })

  it('rejects unknown installer commands', async () => {
    const response = await callInstaller('/mcp/authorize', ['authorize'])

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('Unknown MCP installer command\n')
  })
})
