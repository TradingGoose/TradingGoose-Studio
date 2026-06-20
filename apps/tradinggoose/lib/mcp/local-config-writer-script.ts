export const MCP_LOCAL_CONFIG_WRITER_SCRIPT = String.raw`const fs = require('fs')
const os = require('os')
const path = require('path')

const target = process.argv[2]
const scope = process.argv[3]
const mcpUrl = process.argv[4]
const token = process.argv[5]
const authHeaders = { Authorization: 'Bearer ' + token }
const allTargets = ['codex', 'cursor', 'claude', 'opencode']

function resolvePathFor(candidate, candidateScope) {
  if (candidateScope === 'project') {
    switch (candidate) {
      case 'codex':
        return path.join(process.cwd(), '.codex', 'config.toml')
      case 'cursor':
        return path.join(process.cwd(), '.cursor', 'mcp.json')
      case 'claude':
        return path.join(process.cwd(), '.mcp.json')
      case 'opencode':
        return path.join(process.cwd(), 'opencode.json')
    }
  }

  switch (candidate) {
    case 'codex':
      return path.join(os.homedir(), '.codex', 'config.toml')
    case 'cursor':
      return path.join(os.homedir(), '.cursor', 'mcp.json')
    case 'claude':
      return path.join(os.homedir(), '.claude.json')
    case 'opencode':
      return path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
  }

  throw new Error('Unsupported setup target: ' + candidate)
}

function resolvePath() {
  return resolvePathFor(target, scope)
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function writeCodexConfig(filePath) {
  ensureParent(filePath)
  const block = [
    '[mcp_servers.tradinggoose]',
    'type = "http"',
    'url = ' + JSON.stringify(mcpUrl),
    '',
    '[mcp_servers.tradinggoose.http_headers]',
    'Authorization = ' + JSON.stringify('Bearer ' + token),
    '',
  ].join('\n')
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const sectionHeader = '[mcp_servers.tradinggoose]'
  const startIndex = current.indexOf(sectionHeader)

  if (startIndex === -1) {
    const next = current.trim() ? current.replace(/\s*$/, '') + '\n\n' + block : block
    fs.writeFileSync(filePath, next, 'utf8')
    return
  }

  const subPrefix = '[mcp_servers.tradinggoose.'
  const rest = current.slice(startIndex + sectionHeader.length)
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

  const before = current.slice(0, startIndex).replace(/\n+$/, '')
  const after = current.slice(startIndex + sectionHeader.length + endOffset).replace(/^\n+/, '')
  const next = (before ? before + '\n\n' : '') + block + (after ? '\n' + after : '')
  fs.writeFileSync(filePath, next, 'utf8')
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const text = fs.readFileSync(filePath, 'utf8').trim()
  return text ? JSON.parse(text) : {}
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
  config[section].tradinggoose = entry
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

function bearerTokenFromHeader(value) {
  if (typeof value !== 'string') {
    return null
  }
  const match = value.match(/^Bearer\s+(.+)$/)
  return match ? match[1] : null
}

function readCodexToken(filePath) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const text = fs.readFileSync(filePath, 'utf8')
  const section = text.match(/\[mcp_servers\.tradinggoose\.http_headers\]([\s\S]*?)(?:\n\[|$)/)
  if (!section) {
    return null
  }
  const authorization = section[1].match(/\nAuthorization\s*=\s*["']([^"']+)["']/)
  return authorization ? bearerTokenFromHeader(authorization[1]) : null
}

function readJsonToken(filePath, section) {
  const config = readJson(filePath)
  return bearerTokenFromHeader(config?.[section]?.tradinggoose?.headers?.Authorization)
}

function readTargetToken(candidate) {
  const filePath = resolvePathFor(candidate, scope)
  switch (candidate) {
    case 'codex':
      return readCodexToken(filePath)
    case 'cursor':
    case 'claude':
      return readJsonToken(filePath, 'mcpServers')
    case 'opencode':
      return readJsonToken(filePath, 'mcp')
    default:
      throw new Error('Unsupported setup target: ' + candidate)
  }
}

if (target === 'read-tokens') {
  const seen = new Set()
  for (const candidate of allTargets) {
    const existingToken = readTargetToken(candidate)
    if (existingToken && !seen.has(existingToken)) {
      seen.add(existingToken)
      console.log(existingToken)
    }
  }
  process.exit(0)
}

const filePath = resolvePath()
switch (target) {
  case 'codex':
    writeCodexConfig(filePath)
    break
  case 'cursor':
    writeJsonConfig(filePath, 'mcpServers', { url: mcpUrl, headers: authHeaders })
    break
  case 'claude':
    writeJsonConfig(filePath, 'mcpServers', { type: 'http', url: mcpUrl, headers: authHeaders })
    break
  case 'opencode':
    writeJsonConfig(filePath, 'mcp', {
      type: 'remote',
      url: mcpUrl,
      enabled: true,
      headers: authHeaders,
    })
    break
  default:
    throw new Error('Unsupported setup target: ' + target)
}

console.log(filePath)`
