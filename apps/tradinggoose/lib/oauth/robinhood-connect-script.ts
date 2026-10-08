import { ROBINHOOD_LOOPBACK_REDIRECT_URI, ROBINHOOD_OAUTH_RESOURCE } from './robinhood-constants'

const ROBINHOOD_RELAY_SCRIPT = String.raw`const http = require('node:http')

const hostedOrigin = process.argv[2]
const loopbackUrl = new URL(process.argv[3])
const forwardedParameters = ['code', 'state', 'iss', 'error', 'error_description']
const robinhoodIssuer = ${JSON.stringify(ROBINHOOD_OAUTH_RESOURCE)}
const textHeaders = {
  'cache-control': 'no-store',
  'content-type': 'text/plain; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

function fail(message) {
  console.error('tradinggoose-robinhood: ' + message)
  process.exitCode = 1
}

function sendText(response, status, message) {
  response.writeHead(status, textHeaders)
  response.end(message + '\n')
}

if (Number(process.versions.node.split('.')[0]) < 18) {
  fail('Node.js 18 or newer is required.')
} else {
  let callbackReceived = false
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', loopbackUrl.origin)
    if (request.method !== 'GET' || requestUrl.pathname !== loopbackUrl.pathname) {
      sendText(response, 404, 'Not found')
      return
    }

    if (callbackReceived) {
      sendText(response, 409, 'OAuth callback already received')
      return
    }
    const code = requestUrl.searchParams.get('code')
    const error = requestUrl.searchParams.get('error')
    const issuer = requestUrl.searchParams.get('iss')
    const state = requestUrl.searchParams.get('state')
    const validResponse =
      (!!code && !error && issuer === robinhoodIssuer) || (!!error && !code)
    if (!state || !validResponse) {
      sendText(response, 400, 'Invalid OAuth callback')
      return
    }
    callbackReceived = true

    const hostedCallback = new URL(loopbackUrl.pathname, hostedOrigin)
    for (const parameter of forwardedParameters) {
      const value = requestUrl.searchParams.get(parameter)
      if (value !== null) hostedCallback.searchParams.set(parameter, value)
    }

    response.writeHead(302, {
      'cache-control': 'no-store',
      location: hostedCallback.toString(),
      'x-content-type-options': 'nosniff',
    })
    response.end(() => server.close())
  })

  const timeout = setTimeout(() => {
    server.close()
    fail('Timed out waiting for Robinhood. Run the command again to retry.')
  }, 10 * 60 * 1000)

  server.on('close', () => clearTimeout(timeout))
  server.on('error', (error) => {
    clearTimeout(timeout)
    fail(error.message)
  })
  server.listen(Number(loopbackUrl.port), '127.0.0.1', () => {
    console.log('Robinhood connection helper is ready.')
    console.log('Keep this command running, then use the Robinhood Connect control at:')
    console.log(hostedOrigin)
    console.log('Waiting for Robinhood to return to ' + loopbackUrl.toString())
  })
}
`

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function powerShellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function buildRobinhoodConnectScript(origin: string, format: 'sh' | 'powershell') {
  if (format === 'powershell') {
    return `$ErrorActionPreference = 'Stop'

$HostedOrigin = ${powerShellSingleQuote(origin)}
$LoopbackRedirectUri = ${powerShellSingleQuote(ROBINHOOD_LOOPBACK_REDIRECT_URI)}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'tradinggoose-robinhood: Node.js 18 or newer is required.'
}

$RelayScript = @'
${ROBINHOOD_RELAY_SCRIPT}
'@

$RelayScript | node - $HostedOrigin $LoopbackRedirectUri
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`
  }

  return `#!/bin/sh
set -eu

HOSTED_ORIGIN=${shellSingleQuote(origin)}
LOOPBACK_REDIRECT_URI=${shellSingleQuote(ROBINHOOD_LOOPBACK_REDIRECT_URI)}

command -v node >/dev/null 2>&1 || {
  echo "tradinggoose-robinhood: Node.js 18 or newer is required." >&2
  exit 1
}

node - "$HOSTED_ORIGIN" "$LOOPBACK_REDIRECT_URI" <<'NODE'
${ROBINHOOD_RELAY_SCRIPT}
NODE
`
}
