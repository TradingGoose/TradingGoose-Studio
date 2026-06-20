/**
 * @vitest-environment node
 */

import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MCP_LOCAL_CONFIG_WRITER_SCRIPT } from './local-config-writer-script'

function runWriter(home: string, args: string[]) {
  const scriptPath = join(home, 'writer.js')
  writeFileSync(scriptPath, MCP_LOCAL_CONFIG_WRITER_SCRIPT, 'utf8')
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: home,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
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

function runWriterCapture(home: string, args: string[]) {
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
    },
    timeout: 5000,
  })

  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  return readFileSync(outputPath, 'utf8')
}

describe('MCP local config writer script', () => {
  it('writes Codex config with TradingGoose HTTP headers', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-codex-'))

    runWriter(home, ['codex', 'http://localhost:3000/api/copilot/mcp', 'mcp-token'])

    const configPath = join(home, '.codex', 'config.toml')
    expect(readFileSync(configPath, 'utf8')).toBe(
      [
        '[mcp_servers.TradingGoose]',
        'url = "http://localhost:3000/api/copilot/mcp"',
        '',
        '[mcp_servers.TradingGoose.http_headers]',
        'Authorization = "Bearer mcp-token"',
        '',
      ].join('\n')
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
    expect(config).toContain('[mcp_servers.TradingGoose.http_headers]')
    expect(config).toContain('Authorization = "Bearer new-token"')
    expect(config).toContain('[mcp_servers.other]')
    expect(config).not.toContain('bearer_token_env_var')
  })

  it('reads Codex bearer token from the configured HTTP headers', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-codex-token-'))
    runWriter(home, ['codex', 'http://localhost:3000/api/copilot/mcp', 'existing-token'])

    const stdout = runWriterCapture(home, ['read-tokens'])

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
