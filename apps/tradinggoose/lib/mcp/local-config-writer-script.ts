export const MCP_LOCAL_CONFIG_WRITER_SCRIPT = String.raw`const fs = require('fs')
const os = require('os')
const path = require('path')

const target = process.argv[2]
const mcpUrl = process.argv[3]
const token = process.argv[4]
const authHeaders = { Authorization: 'Bearer ' + token }
const allTargets = ['codex', 'cursor', 'claude', 'opencode']
const mcpServerName = 'TradingGoose'
const codexBearerTokenEnvVar = 'TRADINGGOOSE_BEARER_TOKEN'

function resolvePathFor(candidate) {
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
  return resolvePathFor(target)
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function writeCodexConfig(filePath) {
  ensureParent(filePath)
  const block = [
    '[mcp_servers.' + mcpServerName + ']',
    'url = ' + JSON.stringify(mcpUrl),
    'bearer_token_env_var = ' + JSON.stringify(codexBearerTokenEnvVar),
    '',
  ].join('\n')
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const withoutCurrent = removeTomlMcpServerBlock(current)
  fs.writeFileSync(
    filePath,
    withoutCurrent.trim() ? withoutCurrent.replace(/\s*$/, '') + '\n\n' + block : block,
    'utf8'
  )
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
  config[section][mcpServerName] = entry
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
  const section = findTomlMcpServerSection(text)
  if (!section) {
    return null
  }
  const envVar = section.match(/\nbearer_token_env_var\s*=\s*["']([^"']+)["']/)
  return envVar ? readEnvironmentVariable(envVar[1]) : null
}

function findTomlMcpServerSection(text) {
  const sectionHeader = '[mcp_servers.' + mcpServerName + ']'
  const startIndex = text.indexOf(sectionHeader)
  if (startIndex === -1) {
    return null
  }
  const rest = text.slice(startIndex + sectionHeader.length)
  const nextHeaderIndex = rest.search(/\n\[/)
  return nextHeaderIndex === -1 ? rest : rest.slice(0, nextHeaderIndex)
}

function persistCodexBearerToken() {
  process.env[codexBearerTokenEnvVar] = token

  if (process.platform === 'win32') {
    const { spawnSync } = require('child_process')
    const result = spawnSync('setx', [codexBearerTokenEnvVar, token], { stdio: 'ignore' })
    if (result.status !== 0) {
      throw new Error('Failed to persist ' + codexBearerTokenEnvVar)
    }
  }
}

function readEnvironmentVariable(name) {
  if (process.env[name]) {
    return process.env[name]
  }
  if (process.platform !== 'win32') {
    return null
  }

  const { spawnSync } = require('child_process')
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$Value = [Environment]::GetEnvironmentVariable($args[0], [EnvironmentVariableTarget]::User); if ($Value) { [Console]::Out.Write($Value) }',
      name,
    ],
    { encoding: 'utf8' }
  )
  return result.status === 0 && result.stdout ? result.stdout : null
}

function readJsonToken(filePath, section) {
  const config = readJson(filePath)
  return bearerTokenFromHeader(config?.[section]?.[mcpServerName]?.headers?.Authorization)
}

function readTargetToken(candidate) {
  const filePath = resolvePathFor(candidate)
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
    persistCodexBearerToken()
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
