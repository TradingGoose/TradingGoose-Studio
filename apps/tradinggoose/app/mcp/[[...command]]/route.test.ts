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
    expect(script).toContain('node - "$BASE_URL" "$COMMAND" "$TARGETS"')
    expect(script).toContain('runConfigWriter([target, mcpUrl, login.token])')
    expect(script).toContain("const mcpServerName = 'TradingGoose'")
    expect(script).toContain("'[mcp_servers.' + mcpServerName + '.http_headers]'")
    expect(script).toContain("'Authorization = ' + JSON.stringify('Bearer ' + token)")
    expect(script).not.toContain('TRADINGGOOSE_BEARER_TOKEN')
    expect(script).not.toContain('bearer_token_env_var')
    expect(script).not.toContain("spawnSync('setx'")
    expect(script).toContain("path.join(os.homedir(), '.codex', 'config.toml')")
    expect(script).toContain("path.join(os.homedir(), '.cursor', 'mcp.json')")
    expect(script).toContain("path.join(os.homedir(), '.claude.json')")
    expect(script).toContain("path.join(os.homedir(), '.config', 'opencode', 'opencode.json')")
    expect(script).not.toContain('workspaceId')
    expect(script).not.toContain('entityId')

    const printedTokenIndex = script.indexOf("console.log('Authorization: Bearer ' + login.token)")
    const firstReturnTokenIndex = script.indexOf('return { code, verificationKey, token }')
    const setupIndex = script.indexOf("if (command === 'setup')")
    const configWriteIndex = script.indexOf(
      'const configPath = runConfigWriter([target, mcpUrl, login.token])'
    )
    const acknowledgeIndex = script.indexOf('await acknowledge(login)', setupIndex)
    expect(printedTokenIndex).toBeGreaterThan(firstReturnTokenIndex)
    expect(configWriteIndex).toBeGreaterThan(setupIndex)
    expect(acknowledgeIndex).toBeGreaterThan(setupIndex)
    expect(acknowledgeIndex).toBeLessThan(configWriteIndex)
  })

  it('serves target-specific setup scripts from the URL path', async () => {
    const response = await callInstaller('/mcp/setup/codex', ['setup', 'codex'])
    const script = await response.text()

    expectShellScript(script)
    expect(script).toContain('COMMAND="setup"')
    expect(script).toContain('TARGETS="codex"')
  })

  it('uses request-origin and quoted installer base URLs', async () => {
    const response = await callInstaller(
      '/mcp',
      undefined,
      undefined,
      'https://request.example.test'
    )
    const script = await response.text()

    expect(script).toContain("BASE_URL='https://request.example.test'")
    expect(script).not.toContain("BASE_URL='https://studio.example.test'")

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
    expect(script).toContain("$NodeScript | & node - $BaseUrl $Command ($Targets -join ' ')")
    expect(script).toContain("baseUrl + '/api/auth/mcp/start'")
    expect(script).toContain('ackApiKey: login.token')
    expect(script).not.toContain("runConfigWriter(['read-tokens'])")
    expect(script).not.toContain("method: 'ping'")
    expect(script).toContain("const mcpServerName = 'TradingGoose'")
    expect(script).toContain("'[mcp_servers.' + mcpServerName + '.http_headers]'")
    expect(script).toContain("'Authorization = ' + JSON.stringify('Bearer ' + token)")
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

  it('rejects unknown installer commands', async () => {
    const response = await callInstaller('/mcp/authorize', ['authorize'])

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('Unknown MCP installer command\n')
  })
})
