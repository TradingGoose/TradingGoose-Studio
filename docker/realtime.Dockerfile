# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.2.22-alpine AS base

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install turbo globally
RUN bun install -g turbo

COPY package.json bun.lock ./
RUN mkdir -p apps
COPY apps/tradinggoose/package.json ./apps/tradinggoose/package.json

RUN bun install --omit dev --ignore-scripts

# ========================================
# Builder Stage: Build the Application
# ========================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ========================================
# Runner Stage: Run the Socket Server
# ========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy the sim app and the shared db package needed by socket-server
COPY --from=builder --chown=nextjs:nodejs /app/apps/tradinggoose ./apps/tradinggoose
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Switch to non-root user
USER nextjs

# Expose socket server port (default 3002, but configurable via PORT env var)
EXPOSE 3002
ENV PORT=3002 \
    SOCKET_PORT=3002 \
    HOSTNAME="0.0.0.0"

# Run the socket server directly
CMD ["bun", "apps/tradinggoose/socket-server/index.ts"]