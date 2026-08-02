<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/tradinggoose/public/static/home-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="apps/tradinggoose/public/static/home-light.png">
    <img alt="TradingGoose-Studio" src="https://shieldcn.dev/header/grid.svg?title=TradingGoose-Studio&subtitle=Build+your+own+AI+trading+system&logo=https%3A%2F%2Favatars.githubusercontent.com%2Fu%2F226357056%3Fs%3D200%26v%3D4&mode=light&font=roboto&border=false&brand=TradingGoose" width="2559">
  </picture>
</p>

<p align="center">
  <a href="https://docs.tradinggoose.ai"><img src="https://shieldcn.dev/badge/Docs-ffcc00.svg?size=xs&logo=googledocs&logoColor=202020"></a> 
  <a href="https://discord.gg/wavf5JWhuT"><img src="https://shieldcn.dev/badge/Discord-5865F2.svg?size=xs&logo=discord" alt="Discord"></a> 
  <a href="https://www.tradinggoose.ai"><img src="https://shieldcn.dev/badge/website-ffcc00.svg?size=xs&logo=ri%3AFaGlobe&logoColor=202020" alt="Website"></a> 
</p>

<p align="center">
  <a href="LICENSE"><img src="https://shieldcn.dev/github/license/TradingGoose/TradingGoose-Studio.svg?size=xs&variant=secondary" alt="License"></a>
  <a href="https://github.com/TradingGoose/TradingGoose-Studio"><img src="https://shieldcn.dev/github/stars/TradingGoose/TradingGoose-Studio.svg?size=xs&variant=secondary" alt="GitHub stars"></a>
  <a href="https://github.com/TradingGoose/TradingGoose-Studio/commits"><img src="https://shieldcn.dev/github/last-commit/TradingGoose/TradingGoose-Studio.svg?size=xs&variant=secondary" alt="Last commit"></a>
  
</p>

<p align="center">
  <a href="https://gemini.google.com/app?q=I+am+using+TradingGoose+Studio+from+https%3A%2F%2Fgithub.com%2FTradingGoose%2FTradingGoose-Studio.+How+do+I+build+my+own+AI+trading+system+with+TradingGoose+Studio%3F"><img src="https://shieldcn.dev/badge/Ask%20Gemini-8E75B2.svg?variant=branded&amp;logo=googlegemini" alt="Ask Gemini"></a>
  <a href="https://perplexity.ai?q=I+am+using+TradingGoose+Studio+from+https%3A%2F%2Fgithub.com%2FTradingGoose%2FTradingGoose-Studio.+How+do+I+build+my+own+AI+trading+system+with+TradingGoose+Studio%3F"><img src="https://shieldcn.dev/badge/Ask%20Perplexity-088F8F.svg?variant=branded&amp;logo=perplexity" alt="Ask Perplexity"></a>
</p>

<br />

# Build your own AI trading system

**TradingGoose-Studio is an open-source, AI-native trading analysis and automation system.**

Build your own AI trading system by composing workflows that analyze market signals and portfolio state, then act through approvals, alerts, connected services, or brokers.

**Monitor → Analyze → Execute → Review**

Built for traders, indicator authors, workflow builders, and self-hosting teams that want control over how automation makes and executes decisions.

## How it works

```mermaid
flowchart LR
  BUILD["1 · Build & deploy<br/>Create your AI trading workflow"] --> MONITOR["2 · Configure a monitor<br/>Choose a trigger source"]
  MONITOR --> MARKET["Market signal<br/>Indicator condition"]
  MONITOR --> PORTFOLIO["Portfolio state<br/>Account or position condition"]
  MARKET --> RUN["3 · Signal matches<br/>The AI workflow analyzes and decides"]
  PORTFOLIO --> RUN
  RUN --> OUTCOME["4 · Configured outcome<br/>Approve · alert · service · broker action"]
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/tradinggoose/public/static/preview-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="apps/tradinggoose/public/static/preview-light.png">
  <img alt="TradingGoose workspace with Copilot, charts, indicators, and workflows" src="apps/tradinggoose/public/static/preview-light.png" width="2559">
</picture>


## The four pillars

Four product surfaces work together to turn market context into a controlled AI trading system.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Trading workspace</h3>
      <p>Organize the views and tools for a trading process in saved layouts.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📡 Monitor system</h3>
      <p>Use one system for market-data indicator events and connected-broker portfolio or position conditions. Both trigger deployed workflows.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔀 Decision workflows</h3>
      <p>Compose AI agents with market context, tools, rules, conditions, and approvals on a visual canvas.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎯 Controlled execution</h3>
      <p>Run the alerts, service calls, or broker actions you configure and review each execution.</p>
    </td>
  </tr>
</table>

## Features

| Capability | What you can do |
| --- | --- |
| **Custom market views** | Pair charts, watchlists, portfolios, and orders in saved layouts. |
| **Indicator authoring** | Use built-in studies or PineTS scripts, then reuse them as signal inputs. |
| **Context-rich agents** | Give agents market, portfolio, knowledge, memory, and tool context. |
| **Deterministic controls** | Route, loop, run in parallel, wait, branch on conditions, and require approval. |
| **Connected actions** | Use Alpaca or Tradier, APIs, SDKs, webhooks, and MCP from the same system. |
| **Run history** | Inspect streamed outputs, execution logs, and order records after every run. |

## Problems TradingGoose-Studio solves

| Without TradingGoose-Studio | With TradingGoose-Studio |
| --- | --- |
| ❌ Market context, portfolio state, AI analysis, and actions live in separate tools. | ✔️ One workspace connects them through monitors and workflows. |
| ❌ An indicator can tell you something happened, but not what to do next. | ✔️ Monitor events feed a workflow that can analyze, gate, alert, or act. |
| ❌ AI trading logic is trapped in prompts or one-off scripts. | ✔️ Build and deploy a visual AI trading system you can inspect and change. |
| ❌ Automation can act without a clear review point. | ✔️ Put rules and approvals in the workflow and inspect each execution. |
| ❌ You have to accept a fixed strategy or hosted stack. | ✔️ Bring your data, models, tools, and broker connections and define your own system. |

## Ready to build with

This is the build kit already included in TradingGoose-Studio. Canvas types and agent actions are counted separately: the action total only includes built-in tools the Agent runtime can resolve.

|  |  |
| --- | --- |
| **151 user-addable canvas types** | 15 core blocks, 124 tool blocks, 10 trigger blocks, and loop and parallel control-flow containers. |
| **10 trigger types** | Start workflows from manual or input runs, schedules, APIs, chats, webhooks, RSS or IMAP, indicator events, and portfolio-state conditions. |
| **254 agent-callable actions across 71 integrations** | Give agents market research, data, communications, storage, web access, and configured trading actions. |
| **86 built-in PineTS studies** | Use them in charts, Copilot, and Function blocks; author or import a trigger-enabled indicator when a market monitor should start a workflow. |
| **4 market-data providers** | Alpaca, Finnhub, Alpha Vantage and Yahoo Finance. All support series; Alpaca and Finnhub also provide live data. |
| **2 trading providers** | Alpaca and Tradier provide portfolio context and configured order actions. |
| **16 AI providers** | Choose from direct, cloud, and local model-provider options for agents. |

Connect the credentials, endpoint, or broker account required by each provider. Custom tools and connected MCP servers are workspace-specific, so they are deliberately not included in the fixed counts above.

### The Systems

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>Provider adapters</strong> — AI providers, market-data feeds, and trading services are exposed through consistent interfaces for models, market context, portfolio state, and broker accounts.
    </td>
    <td width="50%" valign="top">
      <strong>Indicator runtime</strong> — PineTS compilation, series normalization, local or sandboxed execution, and trigger detection turn custom indicator code into reusable signals.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>Workflow executor</strong> — Versioned definitions run through agent, function, condition, router, loop, parallel, wait, trigger, and response handlers, with background jobs and streamed run events.
    </td>
    <td width="50%" valign="top">
      <strong>Persistence and extension boundary</strong> — PostgreSQL and Drizzle persist workspace, workflow, monitor, run, and order state; Redis, Socket.IO, and Yjs synchronize it; APIs, SDKs, MCP, webhooks, and custom tools extend it.
    </td>
  </tr>
</table>

## Copilot MCP

The Copilot-MCP allows Claude Code, Cursor, OpenCode, Codex, Antigravity, or Gemini CLI to control/edit your TradingGoose workspace. It requires Node.js 18 or newer and access to the TradingGoose instance.

Choose your platform and open only the instructions you need.
<details>
<summary><strong>macOS / Linux / WSL</strong></summary>

```bash
curl -fsSL https://tradinggoose.ai/mcp/setup | sh
```

For a self-hosted instance, replace `https://tradinggoose.ai` with its URL, such as `http://localhost:3000`.

</details>

<details>
<summary><strong>Windows PowerShell</strong></summary>

```powershell
irm https://tradinggoose.ai/mcp/setup | iex
```

For a self-hosted instance, replace `https://tradinggoose.ai` with its URL, such as `http://localhost:3000`.

</details>
<br>
The setup endpoint opens an interactive target picker. Append a supported target to configure it directly—for example, `/mcp/setup/codex`. Self-hosted MCP setup requires `API_ENCRYPTION_KEY`.

## FAQ

<details>
<summary><strong>What can the Monitor system watch?</strong></summary>

It supports two sources: indicator events from market data, and conditions on a connected broker account's portfolio or positions. Both sources can start a deployed workflow.

</details>

<details>
<summary><strong>Can I build my own AI trading system?</strong></summary>

Yes. Compose monitors, AI agents, tools, rules, approvals, and actions into a system shaped around your own strategy. Deterministic conditions and approvals remain available as controls around the AI analysis.

</details>

<details>
<summary><strong>Can TradingGoose place trades automatically?</strong></summary>

Only when you explicitly configure a workflow and connect a broker account. TradingGoose does not place trades on its own and is not financial advice.

</details>

<details>
<summary><strong>Can I write my own indicators?</strong></summary>

Yes. Use the built-in studies or author custom indicators with PineTS, then use their events as monitor inputs.

</details>

<details>
<summary><strong>Can I self-host it?</strong></summary>

Yes. Run the repository locally or deploy it on your own infrastructure with your own database, credentials, and integrations.

</details>

## Development

### Run the repository locally

<details>
<summary><strong>Installation</strong></summary>

Requires Bun 1.3 or newer, Node.js 20.x, and Docker. The repository pins Bun `1.3.11`.

```bash
git clone https://github.com/TradingGoose/TradingGoose-Studio.git
cd TradingGoose-Studio
bun install

cp apps/tradinggoose/.env.example apps/tradinggoose/.env
cp packages/db/.env.example packages/db/.env

docker run --name tradinggoose-db --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=tradinggoose --publish 5432:5432 --detach pgvector/pgvector:pg17
docker run --name tradinggoose-redis --publish 6379:6379 --detach redis:7.2.1-alpine
```

Set `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tradinggoose"` in both environment files. Replace the `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `INTERNAL_API_SECRET` placeholders in `apps/tradinggoose/.env` with separate 64-character hexadecimal values. Set `API_ENCRYPTION_KEY` too if you will use API keys or MCP.

```bash
bun run db:migrate
bun run dev:full
```

Open [http://localhost:3000](http://localhost:3000). The realtime service runs on port `3002`.

</details>

<details>
<summary><strong>Repository checks</strong></summary>

Run these from the repository root:

```bash
bun run build
bun run test
bun run type-check
bun run lint:check
bun run format:check
bun run docs:audit
```

</details>

<details>
<summary><strong>Tech stack</strong></summary>

| Area | Technologies |
| --- | --- |
| Framework | <a href="https://nextjs.org/"><img src="https://shieldcn.dev/badge/Next.js-18181b.svg?variant=secondary&amp;logo=nextdotjs" alt="Next.js"></a> |
| Runtime | <a href="https://bun.sh/"><img src="https://shieldcn.dev/badge/Bun-18181b.svg?variant=secondary&amp;logo=bun" alt="Bun"></a> |
| Database | <a href="https://www.postgresql.org/"><img src="https://shieldcn.dev/badge/PostgreSQL-18181b.svg?variant=secondary&amp;logo=postgresql" alt="PostgreSQL"></a> <a href="https://orm.drizzle.team"><img src="https://shieldcn.dev/badge/Drizzle%20ORM-18181b.svg?variant=secondary&amp;logo=drizzle" alt="Drizzle ORM"></a> |
| Authentication | <a href="https://better-auth.com"><img src="https://shieldcn.dev/badge/Better%20Auth-18181b.svg?variant=secondary&amp;logo=betterauth" alt="Better Auth"></a> |
| UI | <a href="https://ui.shadcn.com/"><img src="https://shieldcn.dev/badge/shadcn%20ui-18181b.svg?variant=secondary&amp;logo=shadcnui" alt="shadcn/ui"></a> <a href="https://tailwindcss.com"><img src="https://shieldcn.dev/badge/Tailwind%20CSS-18181b.svg?variant=secondary&amp;logo=tailwindcss" alt="Tailwind CSS"></a> |
| State | <a href="https://zustand-demo.pmnd.rs/"><img src="https://shieldcn.dev/badge/Zustand-18181b.svg?variant=secondary&amp;logo=ri:GiBearHead" alt="Zustand"></a> |
| Realtime | <a href="https://socket.io/"><img src="https://shieldcn.dev/badge/Socket.IO-18181b.svg?variant=secondary&amp;logo=socketdotio" alt="Socket.IO"></a> <a href="https://github.com/yjs/yjs"><img src="https://shieldcn.dev/badge/Yjs-18181b.svg?variant=secondary&amp;logo=ri:LuNetwork" alt="Yjs"></a> |
| Flow editor | <a href="https://reactflow.dev/"><img src="https://shieldcn.dev/badge/React%20Flow-18181b.svg?variant=secondary&amp;logo=xyflow" alt="React Flow"></a> |
| Documentation | <a href="https://fumadocs.vercel.app/"><img src="https://shieldcn.dev/badge/Fumadocs-18181b.svg?variant=secondary&amp;logo=ri:LuBookOpen" alt="Fumadocs"></a> |
| Monorepo | <a href="https://turborepo.org/"><img src="https://shieldcn.dev/badge/Turborepo-18181b.svg?variant=secondary&amp;logo=turborepo" alt="Turborepo"></a> |
| Background jobs | <a href="https://trigger.dev/"><img src="https://shieldcn.dev/badge/Trigger.dev-18181b.svg?variant=secondary&amp;logo=ri:LuZap" alt="Trigger.dev"></a> |
| Remote execution | <a href="https://www.e2b.dev/"><img src="https://shieldcn.dev/badge/E2B-18181b.svg?variant=secondary&amp;logo=ri:LuSquareTerminal" alt="E2B"></a> |
| Charting | <a href="https://www.tradingview.com/lightweight-charts/"><img src="https://shieldcn.dev/badge/Lightweight%20Charts-18181b.svg?variant=secondary&amp;logo=tradingview" alt="Lightweight Charts"></a> |
| Indicator engine | <a href="https://github.com/QuantForgeOrg/PineTS"><img src="https://shieldcn.dev/badge/PineTS-18181b.svg?variant=secondary" alt="PineTS"></a> |
| Drawing tools | <a href="https://github.com/difurious/lightweight-charts-line-tools-core"><img src="https://shieldcn.dev/badge/Line%20Tools-18181b.svg?variant=secondary" alt="Line Tools"></a> |

</details>

## Contributing

Pull requests are welcome.

If you want to improve TradingGoose-Studio, fix a bug, tighten the docs, or ship an idea that makes the platform better for traders and builders, open a PR. Small, focused changes are preferred and easier to review.

This project is moving quickly and is expected to have bugs and frequent breaking changes. Contributors should expect the codebase, interfaces, and workflows to change often, sometimes week to week.

- Read the [Contributing Guide](.github/CONTRIBUTING.md) for setup, workflow, and PR expectations.
- Review the [Code of Conduct](.github/CODE_OF_CONDUCT.md) before participating in project spaces.
- Follow the [Security Policy](.github/SECURITY.md) when reporting vulnerabilities.
- Open an issue first if you want feedback on larger changes or architecture work.

## License

TradingGoose-Studio is licensed under **AGPL-3.0**. See [LICENSE](LICENSE) for the complete terms and [NOTICE](NOTICE), [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES), and [LICENSES](LICENSES/) for third-party notices and license texts.

The combined project remains AGPL-3.0 so users can use, study, modify, self-host, and redistribute it under the same terms. TradingGoose-Studio integrates PineTS under its AGPL terms; the corresponding attribution and license text are preserved in the repository.

Apache-2.0 notices and the full text for included Apache-licensed components are preserved in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt) and [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES).

The chart drawing tools vendored in `apps/tradinggoose/widgets/widgets/data_chart/plugins/` carry their own [MPL-2.0 license](apps/tradinggoose/widgets/widgets/data_chart/plugins/LICENSE). Those modified source files remain covered by MPL-2.0 at the file level; the repository-level AGPL-3.0 distribution does not replace those terms.

---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/tradinggoose/public/static/footer-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="apps/tradinggoose/public/static/footer-light.png">
    <img alt="TradingGoose" src="apps/tradinggoose/public/static/footer-light.png">
  </picture>
</p>
