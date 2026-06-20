/**
 * @vitest-environment node
 */

import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MCP_LOCAL_CONFIG_WRITER_SCRIPT } from './local-config-writer-script'

type TestEnv = Record<string, string | undefined>

function runWriter(home: string, args: string[], env: TestEnv = {}) {
  const scriptPath = join(home, 'writer.js')
  writeFileSync(scriptPath, MCP_LOCAL_CONFIG_WRITER_SCRIPT, 'utf8')
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: home,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ...env,
    },
    input: MCP_LOCAL_CONFIG_WRITER_SCRIPT,
    timeout: 5000,
  })

  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  return result.stdout
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function runWriterCapture(home: string, args: string[], env: TestEnv = {}) {
  const scriptPath = join(home, 'writer.js')
  const outputPath = join(home, 'writer.out')
  writeFileSync(scriptPath, MCP_LOCAL_CONFIG_WRITER_SCRIPT, 'utf8')
  const command = `node ${shellQuote(scriptPath)} ${args.map(shellQuote).join(' ')} > ${shellQuote(outputPath)}`
  const result = spawnSync('sh', ['-c', command], {
    cwd: home,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ...env,
    },
    timeout: 5000,
  })

  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  return readFileSync(outputPath, 'utf8')
}

describe('MCP local config writer script', () => {
  it('writes Codex config with a TradingGoose bearer token environment variable', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-codex-'))

    runWriter(home, ['codex', 'http://localhost:3000/api/copilot/mcp', 'mcp-token'], {
      SHELL: '/bin/zsh',
    })

    const configPath = join(home, '.codex', 'config.toml')
    expect(readFileSync(configPath, 'utf8')).toBe(
      [
        '[mcp_servers.TradingGoose]',
        'url = "http://localhost:3000/api/copilot/mcp"',
        'bearer_token_env_var = "TRADINGGOOSE_BEARER_TOKEN"',
        '',
      ].join('\n')
    )
    expect(readFileSync(join(home, '.codex', 'tradinggoose-mcp.env'), 'utf8')).toBe(
      "export TRADINGGOOSE_BEARER_TOKEN='mcp-token'\n"
    )
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(
      `[ -f '${join(home, '.codex', 'tradinggoose-mcp.env')}' ] && . '${join(
        home,
        '.codex',
        'tradinggoose-mcp.env'
      )}'\n`
    )
  })

  it('replaces the canonical Codex config while preserving other servers', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-codex-replace-'))
    const configPath = join(home, '.codex', 'config.toml')
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(
      configPath,
      [
        '[mcp_servers.TradingGoose]',
        'url = "http://localhost:3000/api/copilot/mcp"',
        '',
        '[mcp_servers.other]',
        'command = "npx"',
        '',
      ].join('\n'),
      'utf8'
    )

    runWriter(home, ['codex', 'http://localhost:3000/api/copilot/mcp', 'new-token'])

    const config = readFileSync(configPath, 'utf8')
    expect(config.match(/\[mcp_servers\.TradingGoose\]/g)).toHaveLength(1)
    expect(config).toContain('bearer_token_env_var = "TRADINGGOOSE_BEARER_TOKEN"')
    expect(config).toContain('[mcp_servers.other]')
    expect(config).not.toContain('Authorization = "Bearer')
  })

  it('reads Codex bearer token from durable local state after setup', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-codex-token-'))
    runWriter(home, ['codex', 'http://localhost:3000/api/copilot/mcp', 'existing-token'])

    const stdout = runWriterCapture(home, ['read-tokens'], {
      TRADINGGOOSE_BEARER_TOKEN: undefined,
    })

    expect(stdout.trim()).toBe('existing-token')
  })

  it('writes JSON client configs with the TradingGoose server name', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-cursor-'))
    const configPath = join(home, '.cursor', 'mcp.json')
    mkdirSync(join(home, '.cursor'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            Other: { url: 'http://other.example' },
            TradingGoose: { url: 'http://old.example' },
          },
        },
        null,
        2
      ),
      'utf8'
    )

    runWriter(home, ['cursor', 'http://localhost:3000/api/copilot/mcp', 'mcp-token'])

    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      mcpServers: {
        Other: { url: 'http://other.example' },
        TradingGoose: {
          url: 'http://localhost:3000/api/copilot/mcp',
          headers: { Authorization: 'Bearer mcp-token' },
        },
      },
    })
  })
})
