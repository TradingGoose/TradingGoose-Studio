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

const WHITESPACE = ' \t\n\r'

/**
 * Replaces comment bytes with spaces, keeping the text the same length so any
 * offset found in the blanked copy applies directly to the original. That lets
 * a write splice one entry in place instead of re-serialising the whole file,
 * which would delete a JSONC config's comments.
 */
function blankComments(text) {
  let out = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '"') {
      const start = index++
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index++
        index++
      }
      out += text.slice(start, ++index)
    } else if (text[index] === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) {
      const block = text[index + 1] === '*'
      const found = block ? text.indexOf('*/', index + 2) : text.indexOf('\n', index)
      const stop = found === -1 ? text.length : block ? found + 2 : found
      out += text.slice(index, stop).replace(/[^\n]/g, ' ')
      index = stop
    } else {
      out += text[index++]
    }
  }
  return out
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const text = fs.readFileSync(filePath, 'utf8').trim()
  return text ? JSON.parse(blankComments(text)) : {}
}

function skipSpace(text, index) {
  while (index < text.length && WHITESPACE.indexOf(text[index]) !== -1) index++
  return index
}

/** The index sits on a quote; returns the index just past the closing quote. */
function scanString(text, index) {
  index++
  while (index < text.length) {
    if (text[index] === '\\') index += 2
    else if (text[index] === '"') return index + 1
    else index++
  }
  return index
}

/** Returns the index just past the value starting at or after the given index. */
function scanValue(text, index) {
  index = skipSpace(text, index)
  if (text[index] === '"') return scanString(text, index)

  if (text[index] !== '{' && text[index] !== '[') {
    while (index < text.length && ',}]'.indexOf(text[index]) === -1 && WHITESPACE.indexOf(text[index]) === -1) {
      index++
    }
    return index
  }

  let depth = 0
  while (index < text.length) {
    const ch = text[index]
    if (ch === '"') {
      index = scanString(text, index)
      continue
    }
    if (ch === '{' || ch === '[') depth++
    else if ((ch === '}' || ch === ']') && --depth === 0) return index + 1
    index++
  }
  return index
}

/** Span of one member inside the object opening at objOpen, or null. */
function findMember(text, objOpen, key) {
  let index = objOpen + 1
  while (index < text.length) {
    index = skipSpace(text, index)
    if (text[index] === ',') {
      index++
      continue
    }
    if (text[index] !== '"') return null

    const keyStart = index
    const keyEnd = scanString(text, index)
    const colon = skipSpace(text, keyEnd)
    if (text[colon] !== ':') return null
    const valueStart = skipSpace(text, colon + 1)
    const valueEnd = scanValue(text, valueStart)
    if (JSON.parse(text.slice(keyStart, keyEnd)) === key) {
      return { keyStart: keyStart, valueStart: valueStart, valueEnd: valueEnd }
    }
    index = valueEnd
  }
  return null
}

function indentAt(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1
  let cursor = lineStart
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor++
  return text.slice(lineStart, cursor)
}

function serializeValue(value, indent) {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, lineIndex) => (lineIndex === 0 ? line : indent + line))
    .join('\n')
}

/** Appends a member just before the closing brace, keeping comments in place. */
function insertMember(original, scan, objOpen, key, value) {
  const closeIndex = scanValue(scan, objOpen) - 1
  const baseIndent = indentAt(original, objOpen)
  const memberIndent = baseIndent + '  '

  let last = closeIndex - 1
  while (last > objOpen && WHITESPACE.indexOf(scan[last]) !== -1) last--

  // The comma goes right after the previous value, not after a trailing
  // comment, which would swallow it.
  let text = original
  let close = closeIndex
  if (last > objOpen && scan[last] !== ',') {
    text = text.slice(0, last + 1) + ',' + text.slice(last + 1)
    close += 1
  }

  const member = '\n' + memberIndent + JSON.stringify(key) + ': ' + serializeValue(value, memberIndent)
  return text.slice(0, close).replace(/\s*$/, '') + member + '\n' + baseIndent + text.slice(close)
}

/** Returns null when the shape is not safely editable, so the caller re-serialises. */
function spliceServerEntry(original, section, entry) {
  const scan = blankComments(original)
  const rootOpen = skipSpace(scan, 0)
  if (scan[rootOpen] !== '{') return null

  const sectionSpan = findMember(scan, rootOpen, section)
  if (!sectionSpan) {
    const wrapper = {}
    wrapper[mcpServerName] = entry
    return insertMember(original, scan, rootOpen, section, wrapper)
  }
  if (scan[sectionSpan.valueStart] !== '{') return null

  const existing = findMember(scan, sectionSpan.valueStart, mcpServerName)
  if (!existing) {
    return insertMember(original, scan, sectionSpan.valueStart, mcpServerName, entry)
  }
  return (
    original.slice(0, existing.valueStart) +
    serializeValue(entry, indentAt(original, existing.keyStart)) +
    original.slice(existing.valueEnd)
  )
}

function writeJsonConfig(filePath, section, entry) {
  ensureParent(filePath)
  const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const config = original.trim() ? JSON.parse(blankComments(original)) : {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(filePath + ' must contain a JSON object')
  }

  const current = config[section]
  const sectionIsObject = Boolean(current) && typeof current === 'object' && !Array.isArray(current)
  const alreadyExists = sectionIsObject && Object.prototype.hasOwnProperty.call(current, mcpServerName)

  const spliced = original.trim() ? spliceServerEntry(original, section, entry) : null
  if (spliced !== null) {
    fs.writeFileSync(filePath, spliced, 'utf8')
    return alreadyExists
  }

  if (!sectionIsObject) config[section] = {}
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
