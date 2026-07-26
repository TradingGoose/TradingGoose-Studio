/**
 * @vitest-environment node
 */

import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
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

  it.each([
    [
      'claude',
      ['.claude.json'],
      {
        mcpServers: {
          TradingGoose: {
            type: 'http',
            url: 'http://localhost:3000/api/copilot/mcp',
            headers: { Authorization: 'Bearer mcp-token' },
          },
        },
      },
    ],
    [
      'opencode',
      ['.config', 'opencode', 'opencode.json'],
      {
        mcp: {
          TradingGoose: {
            type: 'remote',
            url: 'http://localhost:3000/api/copilot/mcp',
            enabled: true,
            headers: { Authorization: 'Bearer mcp-token' },
          },
        },
      },
    ],
    [
      'gemini',
      ['.gemini', 'settings.json'],
      {
        mcpServers: {
          TradingGoose: {
            httpUrl: 'http://localhost:3000/api/copilot/mcp',
            headers: { Authorization: 'Bearer mcp-token' },
          },
        },
      },
    ],
    [
      'antigravity',
      ['.gemini', 'config', 'mcp_config.json'],
      {
        mcpServers: {
          TradingGoose: {
            serverUrl: 'http://localhost:3000/api/copilot/mcp',
            headers: { Authorization: 'Bearer mcp-token' },
          },
        },
      },
    ],
  ])('writes %s config', (target, pathParts, expectedConfig) => {
    const home = mkdtempSync(join(tmpdir(), `tg-mcp-${target}-`))
    const configPath = join(home, ...pathParts)

    runWriter(home, [target, 'http://localhost:3000/api/copilot/mcp', 'mcp-token'])

    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(expectedConfig)
  })

  it('reports the resolved path and whether the entry already existed', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-report-'))

    const first = JSON.parse(
      runWriter(home, ['cursor', 'http://localhost:3000/api/copilot/mcp', 't1'])
    )
    expect(first).toEqual({ path: join(home, '.cursor', 'mcp.json'), alreadyExists: false })

    const second = JSON.parse(
      runWriter(home, ['cursor', 'http://localhost:3000/api/copilot/mcp', 't2'])
    )
    expect(second).toEqual({ path: join(home, '.cursor', 'mcp.json'), alreadyExists: true })
  })

  it('updates an existing OpenCode variant instead of creating the canonical file', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-opencode-variant-'))
    const variantPath = join(home, '.config', 'opencode', 'opencode.jsonc')
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    writeFileSync(variantPath, '{\n  // existing config\n  "mcp": {}\n}\n', 'utf8')

    const result = JSON.parse(
      runWriter(home, ['opencode', 'http://localhost:3000/api/copilot/mcp', 'mcp-token'])
    )

    expect(result.path).toBe(variantPath)
    expect(existsSync(join(home, '.config', 'opencode', 'opencode.json'))).toBe(false)
    expect(JSON.parse(readFileSync(variantPath, 'utf8')).mcp.TradingGoose.type).toBe('remote')
  })

  it('rejects unsupported targets', () => {
    const home = mkdtempSync(join(tmpdir(), 'tg-mcp-unknown-'))
    const scriptPath = join(home, 'writer.js')
    writeFileSync(scriptPath, MCP_LOCAL_CONFIG_WRITER_SCRIPT, 'utf8')

    const result = spawnSync('node', [scriptPath, 'windsurf', 'http://localhost:3000', 'token'], {
      cwd: home,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
      timeout: 5000,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unsupported setup target: windsurf')
  })
})
