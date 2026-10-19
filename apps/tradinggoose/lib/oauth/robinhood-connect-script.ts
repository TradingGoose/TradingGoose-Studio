import { ROBINHOOD_LOOPBACK_REDIRECT_URI, ROBINHOOD_OAUTH_RESOURCE } from './robinhood-constants'

const ROBINHOOD_RELAY_SCRIPT = String.raw`const http = require('node:http')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const authorizeUrl = new URL(process.argv[2])
const hostedOrigin = authorizeUrl.origin
const completionToken = randomUUID()
authorizeUrl.searchParams.set('relayToken', completionToken)
const loopbackUrl = new URL(${JSON.stringify(ROBINHOOD_LOOPBACK_REDIRECT_URI)})
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

function openBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]]
  let reported = false
  const reportFailure = () => {
    if (reported) return
    reported = true
    console.error('Could not open the browser automatically. Open this URL in a browser on the same computer running this helper:\n' + url)
  }

  const child = spawn(command, args, { detached: true, shell: false, stdio: 'ignore' })
  child.once('error', reportFailure)
  child.once('exit', (code) => {
    if (code !== 0) reportFailure()
  })
  child.unref()
}

if (Number(process.versions.node.split('.')[0]) < 18) {
  fail('Node.js 18 or newer is required.')
} else {
  const server = http.createServer((request, response) => {
    response.setHeader('connection', 'close')
    const requestUrl = new URL(request.url || '/', loopbackUrl.origin)
    if (request.method !== 'GET' || requestUrl.pathname !== loopbackUrl.pathname) {
      sendText(response, 404, 'Not found')
      return
    }

    const completed = requestUrl.searchParams.get('complete') === completionToken
    const code = requestUrl.searchParams.get('code')
    const error = requestUrl.searchParams.get('error')
    const issuer = requestUrl.searchParams.get('iss')
    const state = requestUrl.searchParams.get('state')
    const validResponse = (!!code && !error && issuer === robinhoodIssuer) || (!!error && !code)
    if (!completed && (!state || !validResponse)) {
      sendText(response, 400, 'Invalid OAuth callback')
      return
    }
    const hostedCallback = new URL(
      completed ? authorizeUrl.searchParams.get('callbackURL') : loopbackUrl.pathname,
      hostedOrigin
    )
    for (const parameter of completed ? ['error', 'error_description'] : forwardedParameters) {
      const value = requestUrl.searchParams.get(parameter)
      if (value !== null) hostedCallback.searchParams.set(parameter, value)
    }

    response.writeHead(302, {
      'cache-control': 'no-store',
      location: hostedCallback.toString(),
      'x-content-type-options': 'nosniff',
    })
    response.end(() => {
      if (completed) {
        console.log('Robinhood authorization finished. Helper stopped.')
        server.close()
      }
    })
  })

  server.on('error', (error) => {
    fail(error.message)
  })
  server.listen(Number(loopbackUrl.port), '127.0.0.1', () => {
    console.log('Robinhood connection helper is ready.')
    console.log('The helper closes automatically when Robinhood authorization finishes.')
    console.log('Waiting for Robinhood to return to ' + loopbackUrl.toString())
    openBrowser(authorizeUrl.toString())
  })
}
`

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function powerShellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function buildRobinhoodConnectScript(
  origin: string,
  callbackURL: string,
  format: 'sh' | 'powershell'
) {
  const authorizeUrl = new URL('/connect/robinhood/authorize', origin)
  authorizeUrl.searchParams.set('callbackURL', callbackURL)

  if (format === 'powershell') {
    return `$ErrorActionPreference = 'Stop'

$AuthorizeUrl = ${powerShellSingleQuote(authorizeUrl.toString())}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'tradinggoose-robinhood: Node.js 18 or newer is required.'
}

$RelayScript = @'
${ROBINHOOD_RELAY_SCRIPT}
'@

$RelayScript | node - $AuthorizeUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`
  }

  return `#!/bin/sh
set -eu

AUTHORIZE_URL=${shellSingleQuote(authorizeUrl.toString())}

command -v node >/dev/null 2>&1 || {
  echo "tradinggoose-robinhood: Node.js 18 or newer is required." >&2
  exit 1
}

exec node - "$AUTHORIZE_URL" <<'NODE'
${ROBINHOOD_RELAY_SCRIPT}
NODE
`
}
