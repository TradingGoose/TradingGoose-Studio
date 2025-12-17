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

#### 1. Start Docker (if using Colima on macOS)
```
colima start
```

#### 2. Install dependencies
```
bun install
```

#### 3. Start PostgreSQL database
```
docker run --name tradinggoose-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tradinggoose \
  -p 5432:5432 -d \
  pgvector/pgvector:pg17
```
#### 4. Setup environment variables
```
cd apps/tradinggoose && cp .env.example .env
cd ../../packages/db && cp .env.example .env
```
#### Edit .env files (see configuration below)

#### 5. Run database migrations
```
cd packages/db
bunx drizzle-kit migrate --config=./drizzle.config.ts
```
#### 6. Start development servers
```
cd ../..
bun run dev:full
```

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Runtime**: [Bun](https://bun.sh/)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [Better Auth](https://better-auth.com)
- **UI**: [Shadcn](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Flow Editor**: [ReactFlow](https://reactflow.dev/)
- **Docs**: [Fumadocs](https://fumadocs.vercel.app/)
- **Monorepo**: [Turborepo](https://turborepo.org/)
- **Realtime**: [Socket.io](https://socket.io/)
- **Background Jobs**: [Trigger.dev](https://trigger.dev/)
- **Remote Code Execution**: [E2B](https://www.e2b.dev/)
---

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ by the TradingGoose Team
</p>
