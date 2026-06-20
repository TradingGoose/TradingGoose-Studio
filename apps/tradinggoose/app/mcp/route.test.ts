/**
 * @vitest-environment node
 */

import { spawnSync } from 'child_process'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

describe('MCP install route', () => {
  it('serves a setup script for auth and explicit local MCP target config', async () => {
    const { GET } = await import('./route')

    const response = await GET(new NextRequest('https://studio.example.test/mcp'))
    const script = await response.text()

    const shellCheck = spawnSync('sh', ['-n', '-c', script], {
      encoding: 'utf8',
      timeout: 5000,
    })
    expect(shellCheck.status).toBe(0)
    expect(shellCheck.stderr).toBe('')
    expect(response.headers.get('Content-Type')).toBe('text/x-shellscript; charset=utf-8')
    expect(script).toContain(
      'BASE_URL="$' + '{TRADINGGOOSE_BASE_URL:-https://studio.example.test}"'
    )
    expect(script).toContain('curl -fsSL <studio-url>/mcp | sh -s -- setup --codex')
    expect(script).toContain('$BASE_URL/api/auth/mcp/start')
    expect(script).toContain('$BASE_URL/api/auth/mcp/poll')
    expect(script).toContain('$BASE_URL/api/auth/mcp/revoke')
    expect(script).toContain('$BASE_URL/api/copilot/mcp')
    expect(script).toContain('Authorization: Bearer $TOKEN')
    expect(script).toContain('setup   Authenticate, rotate local MCP auth, and write config.')
    expect(script).toContain('read-tokens')
    expect(script).toContain('add_target codex')
    expect(script).toContain('add_target cursor')
    expect(script).toContain('add_target claude')
    expect(script).toContain('add_target opencode')
    expect(script).toContain('node - "$1" "$SCOPE" "$MCP_URL" "$TOKEN"')
    expect(script).toContain('[mcp_servers.tradinggoose.http_headers]')
    expect(script).toContain("path.join(os.homedir(), '.codex', 'config.toml')")
    expect(script).toContain("path.join(os.homedir(), '.cursor', 'mcp.json')")
    expect(script).toContain("path.join(os.homedir(), '.claude.json')")
    expect(script).toContain("path.join(os.homedir(), '.config', 'opencode', 'opencode.json')")
    expect(script).not.toContain('/mcp/copilot')
    expect(script).not.toContain('/copilot-mcp |')
    expect(script).not.toContain('/copilot-mcp/authorize')
    expect(script).not.toContain('copilot-mcp.sh')
    expect(script).not.toContain('TOKEN_FILE')
    expect(script).not.toContain('copilot-mcp.json')
    expect(script).not.toContain('workspaceId')
    expect(script).not.toContain('entityId')
  })
})
