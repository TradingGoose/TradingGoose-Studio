import { MCP_LOCAL_CONFIG_WRITER_SCRIPT } from './local-config-writer-script'

export function buildMcpInstallScript(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const script = String.raw`#!/bin/sh
set -eu

BASE_URL="\${TRADINGGOOSE_BASE_URL:-${normalizedBaseUrl}}"
SCOPE="global"
TARGETS=""

usage() {
  cat <<'USAGE'
TradingGoose MCP setup

Usage:
  curl -fsSL <studio-url>/mcp | sh -s -- login
  curl -fsSL <studio-url>/mcp | sh -s -- setup --codex
  curl -fsSL <studio-url>/mcp | sh -s -- setup --all

Commands:
  login   Rotate local MCP auth and print a bearer token.
  setup   Authenticate, rotate local MCP auth, and write config.

Options:
  --base-url <url>  Override the Studio URL embedded in this script.
  --codex           Configure Codex.
  --cursor          Configure Cursor.
  --claude          Configure Claude Code.
  --opencode        Configure OpenCode.
  --all             Configure Codex, Cursor, Claude Code, and OpenCode.
  --project         Write project-local config from the current directory.
  --global          Write user-global config. This is the default.
  -h, --help        Show this help.
USAGE
}

fail() {
  echo "tradinggoose-mcp: $*" >&2
  exit 1
}

json_string() {
  sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"
}

json_number() {
  sed -n "s/.*\"$1\":\([0-9][0-9]*\).*/\1/p"
}

add_target() {
  case " $TARGETS " in
    *" $1 "*) ;;
    *) TARGETS="\${TARGETS}\${TARGETS:+ }$1" ;;
  esac
}

choose_targets() {
  if [ -n "$TARGETS" ]; then
    return 0
  fi

  if [ ! -r /dev/tty ]; then
    fail "setup requires a target. Pass --codex, --cursor, --claude, --opencode, or --all."
  fi

  {
    echo "Choose local MCP target:"
    echo "  1) Codex"
    echo "  2) Cursor"
    echo "  3) Claude Code"
    echo "  4) OpenCode"
    echo "  5) All"
    printf "Target [1-5]: "
  } >/dev/tty

  read -r choice </dev/tty
  case "$choice" in
    1) add_target codex ;;
    2) add_target cursor ;;
    3) add_target claude ;;
    4) add_target opencode ;;
    5)
      add_target codex
      add_target cursor
      add_target claude
      add_target opencode
      ;;
    *) fail "Invalid setup target: $choice" ;;
  esac
}

require_node() {
  command -v node >/dev/null 2>&1 || fail "node is required to rotate MCP auth and write config."
}

write_target_config() {
  require_node
  node - "$1" "$SCOPE" "$MCP_URL" "$TOKEN" <<'NODE'
${MCP_LOCAL_CONFIG_WRITER_SCRIPT}
NODE
}

read_existing_tokens() {
  require_node
  node - read-tokens "$SCOPE" <<'NODE'
${MCP_LOCAL_CONFIG_WRITER_SCRIPT}
NODE
}

revoke_existing_tokens() {
  BASE_URL="\${BASE_URL%/}"
  REVOKE_URL="$BASE_URL/api/auth/mcp/revoke"
  TOKENS="$(read_existing_tokens)"

  [ -n "$TOKENS" ] || return 0

  printf '%s\n' "$TOKENS" | while IFS= read -r OLD_TOKEN; do
    [ -n "$OLD_TOKEN" ] || continue
    curl -fsS -X POST -H "Authorization: Bearer $OLD_TOKEN" "$REVOKE_URL" >/dev/null
  done
}

authenticate() {
  BASE_URL="\${BASE_URL%/}"
  MCP_URL="$BASE_URL/api/copilot/mcp"
  START_URL="$BASE_URL/api/auth/mcp/start"
  POLL_URL="$BASE_URL/api/auth/mcp/poll"

  START_JSON="$(curl -fsS -X POST -H 'Content-Type: application/json' "$START_URL")"
  CODE="$(printf '%s' "$START_JSON" | json_string code)"
  AUTHORIZE_URL="$(printf '%s' "$START_JSON" | json_string authorizeUrl)"
  INTERVAL="$(printf '%s' "$START_JSON" | json_number intervalSeconds)"

  [ -n "$CODE" ] || fail "Studio did not return a login code"
  [ -n "$AUTHORIZE_URL" ] || fail "Studio did not return an authorization URL"
  [ -n "$INTERVAL" ] || INTERVAL="2"

  echo "Open this URL in your browser to approve MCP access:"
  echo "$AUTHORIZE_URL"
  echo

  DEADLINE="$(($(date +%s) + 600))"
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    POLL_JSON="$(curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}" "$POLL_URL" || printf '{"status":"pending"}')"
    STATUS="$(printf '%s' "$POLL_JSON" | json_string status)"

    case "$STATUS" in
      approved)
        TOKEN="$(printf '%s' "$POLL_JSON" | json_string apiKey)"
        [ -n "$TOKEN" ] || fail "Studio approved login without returning a token"
        return 0
        ;;
      expired)
        fail "Login expired. Run the command again."
        ;;
      pending|"")
        sleep "$INTERVAL"
        ;;
      *)
        fail "Unexpected login status: $STATUS"
        ;;
    esac
  done

  fail "Timed out waiting for browser approval"
}

COMMAND="\${1:-setup}"
if [ "$#" -gt 0 ]; then
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base-url)
      shift
      [ "$#" -gt 0 ] || fail "--base-url requires a value"
      BASE_URL="$1"
      ;;
    --base-url=*)
      BASE_URL="\${1#--base-url=}"
      ;;
    --codex)
      add_target codex
      ;;
    --cursor)
      add_target cursor
      ;;
    --claude)
      add_target claude
      ;;
    --opencode)
      add_target opencode
      ;;
    --all)
      add_target codex
      add_target cursor
      add_target claude
      add_target opencode
      ;;
    --project)
      SCOPE="project"
      ;;
    --global)
      SCOPE="global"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

case "$COMMAND" in
  login)
    revoke_existing_tokens
    authenticate
    echo "MCP endpoint:"
    echo "$MCP_URL"
    echo
    echo "Bearer token:"
    echo "$TOKEN"
    echo
    echo "Use this MCP auth header:"
    echo "Authorization: Bearer $TOKEN"
    ;;
  setup)
    choose_targets
    revoke_existing_tokens
    authenticate
    echo "Using MCP endpoint: $MCP_URL"
    for TARGET in $TARGETS; do
      CONFIG_PATH="$(write_target_config "$TARGET")"
      echo "Configured $TARGET: $CONFIG_PATH"
    done
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    fail "Unknown command: $COMMAND"
    ;;
esac
`
  return script.replaceAll('\\${', '${')
}
