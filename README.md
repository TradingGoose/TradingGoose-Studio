<p align="center">
  <img src="apps/tradinggoose/public/tradinggoose.svg" alt="TradingGoose Logo" width="120"/>
</p>

<h1 align="center">TradingGoose Studio</h1>

<p align="center">
  <b>AI Workflow Platform for Quantitative Trading</b>
</p>

---

## What is TradingGoose Studio?

TradingGoose Studio is an **AI workflow platform for quantitative trading**.

---

## Quick Start

### Requirements

- **Bun** v1.2+
- **Docker** (for PostgreSQL)
- **Colima** or **Docker Desktop** (macOS)

### Setup Steps

```bash
# 1. Start Docker (if using Colima on macOS)
colima start

# 2. Install dependencies
bun install

# 3. Start PostgreSQL database
docker run --name tradinggoose-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=simstudio \
  -p 5432:5432 -d \
  pgvector/pgvector:pg17

# 4. Setup environment variables
cd apps/tradinggoose && cp .env.example .env
cd ../../packages/db && cp .env.example .env
# Edit .env files (see configuration below)

# 5. Run database migrations
cd packages/db
bunx drizzle-kit migrate --config=./drizzle.config.ts

# 6. Start development servers
cd ../..
bun run dev:full
```

## Documentation

- **[Product Requirements (PRD)](../TradingGoose-Studio-PRD/docs/product/prd.md)** — Goals, scope, and features
- **[Architecture](../TradingGoose-Studio-PRD/docs/architecture/README.md)** — System design

---

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ by the TradingGoose Team
</p>
