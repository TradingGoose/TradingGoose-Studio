# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.3.11-alpine AS base

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

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

RUN bun install --omit dev --ignore-scripts

WORKDIR /app/apps/tradinggoose
RUN bun build --target bun --outfile /tmp/realtime-build/socket-server.js socket-server/index.ts

# ========================================
# Runner Stage: Run the Socket Server
# ========================================
FROM base AS runner
WORKDIR /app/apps/tradinggoose

ENV NODE_ENV=production

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy the bundled socket server runtime artifact only
COPY --from=builder --chown=nextjs:nodejs /tmp/realtime-build/socket-server.js ./socket-server.js

# Switch to non-root user
USER nextjs

# Expose socket server port (default 3002, but configurable via PORT env var)
EXPOSE 3002
ENV PORT=3002 \
    SOCKET_PORT=3002 \
    HOSTNAME="0.0.0.0"

# Run the bundled socket server directly
CMD ["bun", "./socket-server.js"]
