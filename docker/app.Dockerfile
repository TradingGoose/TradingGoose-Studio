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

# Install turbo globally in builder stage
RUN bun install -g turbo@2.5.8

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Installing with full context to prevent missing dependencies error
RUN bun install --omit dev --ignore-scripts

# Required for standalone nextjs build
WORKDIR /app/apps/tradinggoose
RUN bun install sharp@0.34.3

ENV NEXT_TELEMETRY_DISABLED=1 \
    VERCEL_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1

WORKDIR /app

# Provide dummy database URLs during image build so server code that imports @tradinggoose/db
# can be evaluated without crashing. Runtime environments should override these.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}

# Provide dummy NEXT_PUBLIC_APP_URL for build-time evaluation
# Runtime environments should override this with the actual URL
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

RUN bun run build

# ========================================
# Guardrails Stage: Build Presidio runtime
# ========================================
FROM base AS guardrails
RUN apk add --no-cache python3 py3-pip bash
WORKDIR /app/lib/guardrails

COPY apps/tradinggoose/lib/guardrails/setup.sh ./setup.sh
COPY apps/tradinggoose/lib/guardrails/requirements.txt ./requirements.txt
COPY apps/tradinggoose/lib/guardrails/validate_pii.py ./validate_pii.py

RUN chmod +x ./setup.sh && ./setup.sh

# ========================================
# Runner Stage: Run the actual app
# ========================================

FROM base AS runner
WORKDIR /app

# Install Python runtime for guardrails PII detection
RUN apk add --no-cache python3

ENV NODE_ENV=production

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/apps/tradinggoose/public ./apps/tradinggoose/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/tradinggoose/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/tradinggoose/.next/static ./apps/tradinggoose/.next/static
# Preserve Bun's production dependency trees so yjs can resolve lib0 through the
# workspace symlink layout inside the runtime image.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/tradinggoose/node_modules ./apps/tradinggoose/node_modules

# Guardrails runtime assets
COPY --from=guardrails --chown=nextjs:nodejs /tmp/guardrails/venv ./lib/guardrails/venv
COPY --from=guardrails --chown=nextjs:nodejs /tmp/guardrails/validate_pii.py ./lib/guardrails/validate_pii.py

# Create .next/cache directory with correct ownership
RUN mkdir -p apps/tradinggoose/.next/cache && \
    chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

EXPOSE 3000
ENV PORT=3000 \
    HOSTNAME="0.0.0.0"

CMD ["bun", "apps/tradinggoose/server.js"]
