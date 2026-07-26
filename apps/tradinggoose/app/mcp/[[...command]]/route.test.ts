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
    expect(script).toContain('const verificationKey = String(start?.verificationKey ||')
    expect(script).toContain('return { code, verificationKey, token }')
    expect(script).toContain('async function acknowledge(login)')
    expect(script).toContain('ackApiKey: login.token')
    expect(script).not.toContain('confirmLogin')
    expect(script).not.toContain('confirm: true')
    expect(script).toContain("baseUrl + '/api/copilot/mcp'")
    expect(script).not.toContain("method: 'ping'")
    expect(script).toContain("Authorization: Bearer ' + apiKey")
    expect(script).toContain('setup   Write MCP config, authenticating when needed.')
    // Credentials come from our own store, never scraped back out of an agent's
    // MCP config file.
    expect(script).not.toContain('read-tokens')
    // The installer runs from a temp file, not `node -`, so node's stdin stays
    // attached to the terminal for the interactive target picker.
    expect(script).toContain('cat >"$tmp_dir/installer.js" <<\'NODE\'')
    expect(script).toContain(
      'node "$tmp_dir/installer.js" "$BASE_URL" "$COMMAND" "$TARGETS" </dev/tty'
    )
    expect(script).not.toContain('node - "$BASE_URL"')
    expect(script).toContain('runConfigWriter([target, mcpUrl, apiKey])')
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

    const printedTokenIndex = script.indexOf("pc.dim('Authorization: Bearer ' + apiKey)")
    const firstReturnTokenIndex = script.indexOf('return { code, verificationKey, token }')
    expect(printedTokenIndex).toBeGreaterThan(firstReturnTokenIndex)

    // Setup resolves credentials first and only then prompts for targets, so an
    // abandoned login never costs the user a selection.
    const setupIndex = script.indexOf("if (command === 'setup')")
    expect(setupIndex).toBeGreaterThan(-1)
    const guardIndex = script.indexOf('assertSetupIsPossible()', setupIndex)
    const resolveIndex = script.indexOf('await resolveApiKey()', setupIndex)
    const chooseIndex = script.indexOf('await chooseTargets()', setupIndex)
    const configWriteIndex = script.indexOf('configureTarget(target, apiKey)', setupIndex)

    for (const index of [guardIndex, resolveIndex, chooseIndex, configWriteIndex]) {
      expect(index).toBeGreaterThan(setupIndex)
    }
    expect(guardIndex).toBeLessThan(resolveIndex)
    expect(resolveIndex).toBeLessThan(chooseIndex)
    expect(chooseIndex).toBeLessThan(configWriteIndex)

    // Inside resolveApiKey the device login only runs when no saved key works.
    const resolveFnIndex = script.indexOf('async function resolveApiKey()')
    const storedReadIndex = script.indexOf('readStoredApiKey()', resolveFnIndex)
    const validateIndex = script.indexOf('checkStoredApiKey(stored)', resolveFnIndex)
    const loginIndex = script.indexOf('await authenticate()', resolveFnIndex)
    const saveIndex = script.indexOf('saveApiKey(login.token)', resolveFnIndex)
    expect(storedReadIndex).toBeGreaterThan(resolveFnIndex)
    expect(validateIndex).toBeGreaterThan(storedReadIndex)
    expect(loginIndex).toBeGreaterThan(validateIndex)
    expect(saveIndex).toBeGreaterThan(loginIndex)
  })

  it('reuses a valid saved key instead of minting a duplicate', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    // Stored under our own config dir at 0600.
    expect(script).toContain("path.join(os.homedir(), '.tradinggoose')")
    expect(script).toContain("path.join(credentialsDir(), 'credentials.json')")
    expect(script).toContain('TRADINGGOOSE_CONFIG_DIR')
    expect(script).toContain('0o600')
    expect(script).toContain('fs.chmodSync(credentialsFile(), 0o600)')
    // The key is not pinned to an issuing Studio; a foreign key just fails
    // validation and falls through to a fresh login.
    expect(script).toContain('JSON.stringify({ apiKey: token }, null, 2)')
    expect(script).not.toContain('parsed.baseUrl')

    // Validation reuses the MCP endpoint's own auth rather than a new route.
    expect(script).toContain("method: 'tools/list'")
  })

  it('never treats an unverifiable saved key as authenticated', async () => {
    const response = await callInstaller('/mcp')
    const script = await response.text()

    // The endpoint rate-limits before it authenticates, so 429/503/500 prove
    // nothing about the key. Only 2xx may be read as valid, only 401 as invalid.
    expect(script).not.toContain('return response.status !== 401')
    expect(script).toContain("if (response.status === 401) {\n    return { state: 'invalid' }")
    expect(script).toContain("if (response.ok) {\n    return { state: 'valid' }")
    expect(script).toContain("return { state: 'unverified', detail: 'HTTP ' + response.status }")

    // A network failure is unverifiable too, never a silent re-login.
    expect(script).toContain("state: 'unverified',\n      detail: error instanceof Error")

    // Unverifiable stops the run before any config is written.
    const unverifiedIndex = script.indexOf("if (check.state === 'unverified')")
    const failIndex = script.indexOf(
      'Studio could not confirm the saved credentials',
      unverifiedIndex
    )
    expect(unverifiedIndex).toBeGreaterThan(-1)
    expect(failIndex).toBeGreaterThan(unverifiedIndex)
    expect(script).toContain('No configuration was changed')
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
