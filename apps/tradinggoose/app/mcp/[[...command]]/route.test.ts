/**
 * @vitest-environment node
 */

import { spawnSync } from 'child_process'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

async function callInstaller(pathname: string, command?: string[], headers?: HeadersInit) {
  const { GET } = await import('./route')
  return GET(new NextRequest(`https://studio.example.test${pathname}`, { headers }), {
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
  it('serves the default setup script at /mcp', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    expectShellScript(script)
    expect(response.headers.get('Content-Type')).toBe('text/x-shellscript; charset=utf-8')
    expect(script).toContain('BASE_URL="https://studio.example.test"')
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
    expect(script).toContain("postJson(baseUrl + '/api/auth/mcp/poll', { code, verificationKey })")
    expect(script).toContain("baseUrl + '/api/auth/mcp/revoke'")
    expect(script).toContain("baseUrl + '/api/copilot/mcp'")
    expect(script).toContain("Authorization: Bearer ' + token")
    expect(script).toContain('setup   Authenticate, rotate local MCP auth, and write config.')
    expect(script).toContain('read-tokens')
    expect(script).toContain('await revokeTokens(existingTokens, token)')
    expect(script).not.toContain('revokeExistingTokens')
    expect(script).toContain('node - "$BASE_URL" "$COMMAND" "$TARGETS"')
    expect(script).toContain('runConfigWriter([target, mcpUrl, token])')
    expect(script).toContain("const mcpServerName = 'TradingGoose'")
    expect(script).toContain("const codexBearerTokenEnvVar = 'TRADINGGOOSE_BEARER_TOKEN'")
    expect(script).toContain("'bearer_token_env_var = ' + JSON.stringify(codexBearerTokenEnvVar)")
    expect(script).toContain("spawnSync('setx', [codexBearerTokenEnvVar, token]")
    expect(script).toContain("path.join(os.homedir(), '.codex', 'config.toml')")
    expect(script).toContain("path.join(os.homedir(), '.cursor', 'mcp.json')")
    expect(script).toContain("path.join(os.homedir(), '.claude.json')")
    expect(script).toContain("path.join(os.homedir(), '.config', 'opencode', 'opencode.json')")
    expect(script).not.toContain('workspaceId')
    expect(script).not.toContain('entityId')

    const printedTokenIndex = script.indexOf("console.log('Authorization: Bearer ' + token)")
    const firstRevokeIndex = script.indexOf('await revokeTokens(existingTokens, token)')
    const configWriteIndex = script.indexOf(
      'const configPath = runConfigWriter([target, mcpUrl, token])'
    )
    const setupRevokeIndex = script.indexOf(
      'await revokeTokens(existingTokens, token)',
      configWriteIndex
    )
    expect(firstRevokeIndex).toBeGreaterThan(printedTokenIndex)
    expect(setupRevokeIndex).toBeGreaterThan(configWriteIndex)
  })

  it('serves target-specific setup scripts from the URL path', async () => {
    const response = await callInstaller('/mcp/setup/codex', ['setup', 'codex'])
    const script = await response.text()

    expectShellScript(script)
    expect(script).toContain('COMMAND="setup"')
    expect(script).toContain('TARGETS="codex"')
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
    expect(script).toContain("runConfigWriter(['read-tokens'])")
    expect(script).toContain("const mcpServerName = 'TradingGoose'")
    expect(script).toContain("const codexBearerTokenEnvVar = 'TRADINGGOOSE_BEARER_TOKEN'")
    expect(script).toContain("'bearer_token_env_var = ' + JSON.stringify(codexBearerTokenEnvVar)")
    expect(script).toContain("spawnSync('setx', [codexBearerTokenEnvVar, token]")
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
