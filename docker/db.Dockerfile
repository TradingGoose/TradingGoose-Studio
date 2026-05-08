# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app

# Copy only package files needed for migrations
COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/package.json

# Install dependencies
RUN bun install --ignore-scripts

# ========================================
# Runner Stage: Production Environment
# ========================================
FROM oven/bun:1.3.11-alpine AS runner
WORKDIR /app

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy only the migration inputs and runtime files from the db package
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs packages/db/package.json ./packages/db/package.json
COPY --chown=nextjs:nodejs packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY --chown=nextjs:nodejs packages/db/schema.ts ./packages/db/schema.ts
COPY --chown=nextjs:nodejs packages/db/consts.ts ./packages/db/consts.ts
COPY --chown=nextjs:nodejs packages/db/schema ./packages/db/schema
COPY --chown=nextjs:nodejs packages/db/migrations ./packages/db/migrations

# Switch to non-root user
USER nextjs

WORKDIR /app/packages/db
