/**
 * Standalone node script that writes the TradingGoose MCP server entry into a
 * local agent's config file.
 *
 * Invoked as `node writer.js <target> <mcpUrl> <token>`; prints a single JSON
 * line — `{"path":"...","alreadyExists":true|false}` — so the installer can
 * report `configured` vs `reconfigured` the way the Context7 CLI does.
 *
 * Target coverage and per-agent config shapes mirror the Context7 CLI's agent
 * registry, with TradingGoose using a standard `Authorization: Bearer` header
 * instead of a vendor-specific one.
 */
export const MCP_LOCAL_CONFIG_WRITER_SCRIPT = String.raw`const fs = require('fs')
const os = require('os')
const path = require('path')

const target = process.argv[2]
const mcpUrl = process.argv[3]
const token = process.argv[4]
const mcpServerName = 'TradingGoose'

function authHeaders() {
  return { Authorization: 'Bearer ' + token }
}

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

// Config shapes follow each agent's own MCP schema: Claude Code and Codex take
// an explicit http type, Cursor takes a bare url, OpenCode uses a remote entry,
// Gemini CLI expects httpUrl, and Antigravity expects serverUrl.
const AGENTS = {
  claude: {
    displayName: 'Claude Code',
    format: 'json',
    configKey: 'mcpServers',
    paths: function () {
      return process.env.CLAUDE_CONFIG_DIR
        ? [path.join(claudeConfigDir(), '.claude.json'), path.join(os.homedir(), '.claude.json')]
        : [path.join(os.homedir(), '.claude.json')]
    },
    entry: function () {
      return { type: 'http', url: mcpUrl, headers: authHeaders() }
    },
  },
  cursor: {
    displayName: 'Cursor',
    format: 'json',
    configKey: 'mcpServers',
    paths: function () {
      return [path.join(os.homedir(), '.cursor', 'mcp.json')]
    },
    entry: function () {
      return { url: mcpUrl, headers: authHeaders() }
    },
  },
  codex: {
    displayName: 'Codex',
    format: 'toml',
    paths: function () {
      return [path.join(os.homedir(), '.codex', 'config.toml')]
    },
    entry: function () {
      return { url: mcpUrl, headers: authHeaders() }
    },
  },
  opencode: {
    displayName: 'OpenCode',
    format: 'json',
    configKey: 'mcp',
    paths: function () {
      const dir = path.join(os.homedir(), '.config', 'opencode')
      return [
        path.join(dir, 'opencode.json'),
        path.join(dir, 'opencode.jsonc'),
        path.join(dir, '.opencode.json'),
        path.join(dir, '.opencode.jsonc'),
      ]
    },
    entry: function () {
      return { type: 'remote', url: mcpUrl, enabled: true, headers: authHeaders() }
    },
  },
  gemini: {
    displayName: 'Gemini CLI',
    format: 'json',
    configKey: 'mcpServers',
    paths: function () {
      return [path.join(os.homedir(), '.gemini', 'settings.json')]
    },
    entry: function () {
      return { httpUrl: mcpUrl, headers: authHeaders() }
    },
  },
  antigravity: {
    displayName: 'Antigravity',
    format: 'json',
    configKey: 'mcpServers',
    paths: function () {
      return [path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')]
    },
    entry: function () {
      return { serverUrl: mcpUrl, headers: authHeaders() }
    },
  },
}

/**
 * Picks the first candidate that already exists so we update the file the agent
 * actually reads, falling back to the canonical path when none exist yet.
 */
function resolveConfigPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return candidates[0]
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

/** Tolerates .jsonc candidates. Comments are not preserved on write. */
function stripJsonComments(text) {
  let result = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '"') {
      const start = index++
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index++
        index++
      }
      result += text.slice(start, ++index)
    } else if (text[index] === '/' && text[index + 1] === '/') {
      index += 2
      while (index < text.length && text[index] !== '\n') index++
    } else if (text[index] === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      index += 2
    } else {
      result += text[index++]
    }
  }
  return result
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const text = fs.readFileSync(filePath, 'utf8').trim()
  return text ? JSON.parse(stripJsonComments(text)) : {}
}

function writeJsonConfig(filePath, section, entry) {
  ensureParent(filePath)
  const config = readJson(filePath)
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(filePath + ' must contain a JSON object')
  }
  if (!config[section] || typeof config[section] !== 'object' || Array.isArray(config[section])) {
    config[section] = {}
  }
  const alreadyExists = Object.prototype.hasOwnProperty.call(config[section], mcpServerName)
  config[section][mcpServerName] = entry
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return alreadyExists
}

function buildTomlBlock(entry) {
  const lines = ['[mcp_servers.' + mcpServerName + ']']
  for (const key of Object.keys(entry)) {
    if (key === 'headers') continue
    lines.push(key + ' = ' + JSON.stringify(entry[key]))
  }

  const headers = entry.headers
  if (headers && Object.keys(headers).length > 0) {
    lines.push('')
    lines.push('[mcp_servers.' + mcpServerName + '.http_headers]')
    for (const key of Object.keys(headers)) {
      lines.push(key + ' = ' + JSON.stringify(headers[key]))
    }
  }

  return lines.join('\n') + '\n'
}

function removeTomlMcpServerBlock(current) {
  const sectionHeader = '[mcp_servers.' + mcpServerName + ']'
  const subPrefix = '[mcp_servers.' + mcpServerName + '.'
  let next = current

  while (true) {
    const startIndex = next.indexOf(sectionHeader)
    if (startIndex === -1) {
      return next
    }

    const rest = next.slice(startIndex + sectionHeader.length)
    let endOffset = rest.length
    const headerPattern = /^\[/gm
    let match

    while ((match = headerPattern.exec(rest)) !== null) {
      const lineEnd = rest.indexOf('\n', match.index)
      const line = rest.slice(match.index, lineEnd === -1 ? undefined : lineEnd)
      if (!line.startsWith(subPrefix)) {
        endOffset = match.index
        break
      }
    }

    const before = next.slice(0, startIndex).replace(/\n+$/, '')
    const after = next.slice(startIndex + sectionHeader.length + endOffset).replace(/^\n+/, '')
    next = before + (before && after ? '\n\n' : '') + after
  }
}

function writeTomlConfig(filePath, entry) {
  ensureParent(filePath)
  const block = buildTomlBlock(entry)
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const alreadyExists = current.indexOf('[mcp_servers.' + mcpServerName + ']') !== -1
  const withoutCurrent = removeTomlMcpServerBlock(current)
  fs.writeFileSync(
    filePath,
    withoutCurrent.trim() ? withoutCurrent.replace(/\s*$/, '') + '\n\n' + block : block,
    'utf8'
  )
  return alreadyExists
}

const agent = AGENTS[target]
if (!agent) {
  throw new Error('Unsupported setup target: ' + target)
}

const filePath = resolveConfigPath(agent.paths())
const alreadyExists =
  agent.format === 'toml'
    ? writeTomlConfig(filePath, agent.entry())
    : writeJsonConfig(filePath, agent.configKey, agent.entry())

console.log(JSON.stringify({ path: filePath, alreadyExists: alreadyExists }))`
