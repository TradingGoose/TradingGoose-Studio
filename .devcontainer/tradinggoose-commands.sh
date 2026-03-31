#!/bin/bash
# TradingGoose Project Commands
# Source this file to add project-specific commands to your shell
# Add to your ~/.bashrc or ~/.zshrc: source /workspace/.devcontainer/tradinggoose-commands.sh

# Project-specific aliases for TradingGoose development
alias tradinggoose-start="cd /workspace && bun run dev:full"
alias tradinggoose-app="cd /workspace && bun run dev"
alias tradinggoose-sockets="cd /workspace && bun run dev:sockets"
alias tradinggoose-migrate="cd /workspace/apps/tradinggoose && bunx drizzle-kit push"
alias tradinggoose-generate="cd /workspace/apps/tradinggoose && bunx drizzle-kit generate"
alias tradinggoose-rebuild="cd /workspace && bun run build && bun run start"
alias docs-dev="cd /workspace/apps/docs && bun run dev"

# Database connection helpers
alias pgc="PGPASSWORD=postgres psql -h db -U postgres -d tradinggoose"
alias check-db="PGPASSWORD=postgres psql -h db -U postgres -c '\l'"

# Default to workspace directory
cd /workspace 2>/dev/null || true

# Welcome message - show once per session
if [ -z "$TRADINGGOOSE_WELCOME_SHOWN" ]; then
  export TRADINGGOOSE_WELCOME_SHOWN=1

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🚀 TradingGoose Development Environment"
  echo ""
  echo "Project commands:"
  echo "  tradinggoose-start      - Start app + socket server"
  echo "  tradinggoose-app        - Start only main app"
  echo "  tradinggoose-sockets    - Start only socket server"
  echo "  tradinggoose-migrate    - Push schema changes"
  echo "  tradinggoose-generate   - Generate migrations"
  echo ""
  echo "Database:"
  echo "  pgc            - Connect to PostgreSQL"
  echo "  check-db       - List databases"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi
