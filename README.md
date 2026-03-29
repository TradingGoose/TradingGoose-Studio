<h1 align="center">TradingGoose Studio</h1>
<p align="center">
  <b>AI Workflow Platform for Tecnical LLM Trading</b>
</p>

<picture>
  <!-- Image for Dark Mode -->
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/4690c73e-b02f-49b5-a0a2-90f76ed9adc5">
  <!-- Image for Light Mode -->
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/b60d5e74-3a2f-49fb-b4d0-5ae508c4a2cc">
  <!-- Fallback Image (shown if the browser doesn't support themes) -->
  <img alt="Project Screenshot" src="https://github.com/user-attachments/assets/b60d5e74-3a2f-49fb-b4d0-5ae508c4a2cc" width="2559">
</picture>




---

## What is TradingGoose Studio?

TradingGoose Studio is an **AI workflow platform for technical LLM trading**, it combines both technical + LLM analysis for your trading decision.
It is built for analytics, research, charting, monitoring, and workflow automation. 



<picture>
  <!-- Image for Dark Mode -->
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/d6fe11eb-a9fe-4e76-8ab4-eae6fc21d236">
  <!-- Image for Light Mode -->
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/fed1b97b-336d-4812-8b6c-ffd99f385218">
  <!-- Fallback Image (Defaults to Light) -->
  <img alt="Project Overview" src="https://github.com/user-attachments/assets/fed1b97b-336d-4812-8b6c-ffd99f385218" width="2559">
</picture>



## Quick Start

### Requirements

- **Bun** v1.2+
- **Docker** (for PostgreSQL)
- **Colima** or **Docker Desktop** (macOS)

### Setup Steps

#### 1. Install dependencies
```
bun install
```

#### 2. Start PostgreSQL database
```
docker run --name tradinggoose-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tradinggoose \
  -p 5432:5432 -d \
  pgvector/pgvector:pg17
```
#### 3. Setup environment variables
```
cd apps/tradinggoose && cp .env.example .env
cd ../../packages/db && cp .env.example .env
```
#### Edit .env files (see configuration below)

#### 4. Run database migrations
```
cd packages/db
bunx drizzle-kit migrate --config=./drizzle.config.ts
```
#### 5. Start development servers
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
- **Charting Library**: [Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
- **Indicator Engine**: [PineTS](https://github.com/QuantForgeOrg/PineTS) (AGPL-3.0-only; commercial license option upstream)
- **Chart Drawing Tools**: [difurious Line-Tools](https://github.com/difurious/lightweight-charts-line-tools-core)


## Special Thanks

Special thanks to the [Sim Studio](https://github.com/simstudioai) team for open-sourcing the original project this repository is built on top of.
TradingGoose Studio started from Sim Studio [`v0.4.5`](https://github.com/simstudioai/sim/releases/tag/v0.4.5).

---

## License

The combined TradingGoose Studio project is licensed under **AGPL-3.0-only** - see the [LICENSE](LICENSE) file for details.
This is not because the Sim Studio upstream is Apache-2.0; those upstream notices remain preserved. The combined
project is AGPL-3.0-only because TradingGoose Studio integrates PineTS under its AGPL terms, and this project is
intentionally kept as free software so users can use, study, modify, self-host, and redistribute it under the same terms.
Additional attributions and third-party license texts are in [NOTICE](NOTICE) and [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES).
The Apache-2.0 text preserved for Sim Studio and Lightweight Charts is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
Those Apache-related notices still stay in the repository because this project is derived from Apache-licensed upstream
code and also distributes Apache-licensed third-party components whose attribution notices must be preserved.

The chart drawing tools vendored in `apps/tradinggoose/widgets/widgets/data_chart/plugins/`
carry their own MPL-2.0 license file at
`apps/tradinggoose/widgets/widgets/data_chart/plugins/LICENSE`.
Those vendored modified source files remain covered by the MPL-2.0 at the file level.
The project's overall AGPL-3.0-only distribution does not replace or remove the MPL-2.0
terms that continue to apply to that directory.

---

<p align="center">
  Built with ❤️ by the TradingGoose Team
</p>
